import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

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

  const { id: itemId } = await params;

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > 500) {
    return jsonError("UNPROCESSABLE", "留言需為 1–500 個字");
  }

  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId === user.id) {
    return jsonError("CONFLICT", "不能認領自己分享的物品");
  }
  if (item.status !== "published") {
    return jsonError("CONFLICT", "這個物品目前無法留言");
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
        await tx.notification.createMany({
          data: [
            {
              userId: user.id,
              type: "claim_accepted",
              payload: { itemId, itemTitle: item.title },
            },
            {
              userId: item.ownerId,
              type: "new_comment",
              payload: { itemId, itemTitle: item.title, claimerId: user.id },
            },
          ],
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
      return jsonError("CONFLICT", "您已經留言過了");
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

  return NextResponse.json({
    claims: page.map((c) => ({
      id: c.id,
      userId: c.userId,
      message: c.message,
      status: c.status,
      createdAt: c.createdAt,
      user: { nickname: c.user.profile?.nickname ?? "好物共享用戶" },
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
