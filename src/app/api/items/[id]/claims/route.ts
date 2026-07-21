import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { POINT_CATEGORY_SLUG } from "@/lib/categories";
import { db } from "@/lib/db";
import { notifyFavoritersOfItemClaimed } from "@/lib/favorites";
import {
  checkGiveToGetQuota,
  GIVE_TO_GET_CATEGORY_SLUGS,
  GiveToGetQuotaExceededError,
} from "@/lib/give-to-get-quota";
import { checkKeywordBlocklist } from "@/lib/keyword-blocklist";
import { hasActiveLottery } from "@/lib/lottery";
import { createOrMergeNotification } from "@/lib/notifications";
import { containsTaiwanMobileNumber } from "@/lib/phone-guard";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkUserRestriction } from "@/lib/restrictions";
import { isBlockedEitherDirection } from "@/lib/user-blocks";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// POST /api/items/[id]/claims — 留言／認領（M1 範圍簡化：只做「先到先得」，
// 第一則留言自動被接受並把物品轉成 reserved；不做「物主手動挑人」模式，
// 那個留到後面 milestone。理由：今天要上線、且驗收清單明確要求可測試的併發行為
// （兩請求同打 → 恰好一人成功），先到先得剛好對應這個行為，範圍最小可行。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被禁止留言或被全站封鎖的使用者不能認領物品。
  const restriction = await checkUserRestriction(user.id, "claiming");
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  // M2 治理底線：每小時/每日留言次數上限，超過回 429（見 src/lib/rate-limit.ts）。
  try {
    await checkRateLimit(user.id, "claim_create");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  const { id: itemId } = await params;

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > 500) {
    return jsonError("UNPROCESSABLE", "留言需為 1–500 個字");
  }

  // M2 治理底線：關鍵字黑名單攔留言內容，命中就擋（見 src/lib/keyword-blocklist.ts）。
  if (await checkKeywordBlocklist(message)) {
    return jsonError("UNPROCESSABLE", "留言包含不允許的內容，請修改後再送出");
  }

  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { category: { select: { slug: true } } },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId === user.id) {
    return jsonError("CONFLICT", "不能認領自己分享的物品");
  }
  if (item.status !== "published") {
    return jsonError("CONFLICT", "這個物品目前無法留言");
  }

  // M12（docs/plan/m12-product-growth.md 交付內容 3）：封鎖使用者，無感知（silent block）
  // ——通用錯誤訊息，不透露「被封鎖」這個事實。任一方向封鎖過就擋。
  if (await isBlockedEitherDirection(user.id, item.ownerId)) {
    return jsonError("FORBIDDEN", "目前無法對這個物品留言");
  }

  // M9 §9a 交付內容 5：點數類型個資最小化——留言內容禁含疑似台灣手機號（keyword_blocklist
  // 只做子字串比對，攔不了格式，見 src/lib/phone-guard.ts）；只套用在點數類物品，
  // 實體物品/其他類型完全不受影響。
  if (item.category.slug === POINT_CATEGORY_SLUG && containsTaiwanMobileNumber(message)) {
    return jsonError(
      "UNPROCESSABLE",
      "請勿在留言中留下手機號碼等個人資料，本平台不經手點數與會員帳號",
    );
  }

  // M5 抽籤（master-plan §5a 交付內容 2）：物品存在非終態抽籤時，留言與直贈必須讓路，
  // 避免三種選人方式互相打架；抽籤流標/取消/完成之後這個檢查自然放行。
  if (await hasActiveLottery(itemId)) {
    return jsonError("CONFLICT", "物品目前為抽籤模式，無法留言／直贈");
  }

  // M9（master-plan §9a 交付內容 3）：give-to-get 領取配額，只套用在券票點三類物品，
  // 一般實體物品的認領完全不受影響（見 src/lib/give-to-get-quota.ts）。
  if (GIVE_TO_GET_CATEGORY_SLUGS.has(item.category.slug)) {
    try {
      await checkGiveToGetQuota(user.id);
    } catch (e) {
      if (e instanceof GiveToGetQuotaExceededError) return jsonError("RATE_LIMITED", e.message);
      throw e;
    }
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let claim: { id: string };
      try {
        claim = await tx.claimComment.create({
          data: { itemId, userId: user.id, message, status: "pending" },
          select: { id: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new Error("ALREADY_CLAIMED");
        }
        throw e;
      }

      // 原子搶認領：where 條件同時檢查 status 還是 published，兩個並行請求只有一個能
      // 把筆數更新為 1，另一個 count 會是 0，藉此判斷「誰先搶到」而不需要額外的 lock。
      const updated = await tx.item.updateMany({
        where: { id: itemId, status: "published" },
        data: { status: "reserved" },
      });

      if (updated.count === 1) {
        await tx.claimComment.update({
          where: { id: claim.id },
          data: { status: "accepted" },
        });
        await tx.claimComment.updateMany({
          where: { itemId, status: "pending", id: { not: claim.id } },
          data: { status: "declined" },
        });
        await tx.itemStatusLog.create({
          data: {
            itemId,
            fromStatus: "published",
            toStatus: "reserved",
            actorId: user.id,
          },
        });
        // 用 createOrMergeNotification 而不是 createMany：這兩則通知的 payload 都帶
        // itemId，如果同一使用者對同一物品在 30 分鐘窗口內已經有同 type 的未讀通知，
        // 會被合併成一筆而不是各自新增（M4 通知合併，見 src/lib/notifications.ts）。
        await createOrMergeNotification(tx, {
          userId: user.id,
          type: "claim_accepted",
          payload: { itemId, itemTitle: item.title },
        });
        await createOrMergeNotification(tx, {
          userId: item.ownerId,
          type: "new_comment",
          payload: { itemId, itemTitle: item.title, claimerId: user.id },
        });
        // M12（docs/plan/m12-product-growth.md 交付內容 2）：收藏這個物品的其他使用者
        // 收到「已被接走」提醒，排除物主自己與剛剛得標的這位使用者。
        await notifyFavoritersOfItemClaimed(tx, {
          itemId,
          itemTitle: item.title,
          excludeUserIds: [item.ownerId, user.id],
        });
        return { id: claim.id, status: "accepted" as const };
      }

      // 慢了一步：物品已經被別人搶走，這則留言不可能再被接受，直接標記 declined。
      await tx.claimComment.update({
        where: { id: claim.id },
        data: { status: "declined" },
      });
      return { id: claim.id, status: "declined" as const };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_CLAIMED") {
      return jsonError("CONFLICT", "你已經留言過了");
    }
    throw err;
  }
}

// GET /api/items/[id]/claims — 公開，cursor-based 分頁（比照物品詳情頁本身是公開的）。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: itemId } = await params;

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const claims = await db.claimComment.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      message: true,
      status: true,
      createdAt: true,
      user: { select: { profile: { select: { nickname: true } } } },
    },
  });

  const hasMore = claims.length > take;
  const page = hasMore ? claims.slice(0, take) : claims;

  // 正式上線衝刺（貢獻值排行榜＋徽章）：留言者旁邊要顯示身份組／貢獻值徽章，這裡一次把
  // 這一頁留言者的角色與累計貢獻值都查出來，而不是每則留言各自查一次（N+1）。單頁最多
  // MAX_PAGE_SIZE（50）則留言，去重後的 userIds 數量必然更少，兩次查詢皆有界。
  const userIds = [...new Set(page.map((c) => c.userId))];
  const [roleRows, contributionRows] =
    userIds.length > 0
      ? await Promise.all([
          db.userRole.findMany({
            where: { userId: { in: userIds } },
            select: { userId: true, role: true },
          }),
          db.contributionEvent.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds } },
            _sum: { points: true },
          }),
        ])
      : ([[], []] as [
          Array<{ userId: string; role: string }>,
          Array<{ userId: string; _sum: { points: number | null } }>,
        ]);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) {
    rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.role]);
  }
  const pointsByUser = new Map(contributionRows.map((c) => [c.userId, c._sum.points ?? 0]));

  return NextResponse.json({
    claims: page.map((c) => ({
      id: c.id,
      userId: c.userId,
      message: c.message,
      status: c.status,
      createdAt: c.createdAt,
      user: {
        nickname: c.user.profile?.nickname ?? "好物共享使用者",
        roles: rolesByUser.get(c.userId) ?? [],
        contributionPoints: pointsByUser.get(c.userId) ?? 0,
      },
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
