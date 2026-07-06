import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { hasActiveLottery } from "@/lib/lottery";
import { createOrMergeNotification } from "@/lib/notifications";
import { checkFullBlock } from "@/lib/restrictions";

const DIRECT_SHARE_TTL_MS = 72 * 60 * 60 * 1000; // 72 小時

// POST /api/items/[id]/direct-shares — 物主直接指定某使用者贈與（M1：直贈）。
// MVP 簡化：目前沒有使用者搜尋 UI，用「輸入對方 email」解析成 userId；
// 同一物品同時間只允許一筆 pending 直贈，避免物主亂發邀請造成混亂。
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

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId !== user.id) return jsonError("FORBIDDEN", "只有物主可以贈與這個物品");
  if (item.status !== "published") {
    return jsonError("CONFLICT", "這個物品目前無法贈與");
  }

  // M5 抽籤（master-plan §5a 交付內容 2）：物品存在非終態抽籤時，留言與直贈必須讓路。
  if (await hasActiveLottery(itemId)) {
    return jsonError("CONFLICT", "物品目前為抽籤模式，無法留言/直贈");
  }

  const body = await req.json().catch(() => null);
  const receiverEmail = typeof body?.receiverEmail === "string" ? body.receiverEmail.trim() : "";
  if (!receiverEmail) {
    return jsonError("UNPROCESSABLE", "請輸入對方 email");
  }
  if (receiverEmail.toLowerCase() === user.email.toLowerCase()) {
    return jsonError("UNPROCESSABLE", "不能贈送給自己");
  }

  const receiver = await db.user.findUnique({ where: { email: receiverEmail.toLowerCase() } });
  if (!receiver) {
    return jsonError("UNPROCESSABLE", "找不到這個使用者");
  }

  const now = new Date();
  // findFirst 跟 create 中間有時間差，物主快速重複點擊或多個併發請求可能同時通過檢查、
  // 各自建立一筆 pending 直贈。用 `SELECT ... FOR UPDATE` 鎖住這個 item 的資料列，讓併發
  // 請求排隊逐一處理，確保「同一物品同時最多一筆 pending 直贈」這條規則不會被搶過去。
  let created: { id: string };
  try {
    created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR UPDATE`;

      const existingPending = await tx.directShare.findFirst({
        where: { itemId, status: "pending" },
      });
      if (existingPending) {
        throw new Error("DIRECT_SHARE_PENDING_EXISTS");
      }

      return tx.directShare.create({
        data: {
          itemId,
          receiverId: receiver.id,
          status: "pending",
          expiresAt: new Date(now.getTime() + DIRECT_SHARE_TTL_MS),
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "DIRECT_SHARE_PENDING_EXISTS") {
      return jsonError("CONFLICT", "已經有一筆進行中的直贈邀請");
    }
    throw e;
  }

  // 直贈邀請已經在上面的 transaction 裡成功建立並提交，通知只是附加效果：通知建立失敗
  // （例如暫時性的資料庫連線問題）不該讓這支 API 回 500，否則物主會誤以為邀請沒建立成功
  // 而重試，卻因為「同一物品同時最多一筆 pending 直贈」這條規則而收到衝突錯誤。
  // 因此這裡刻意不讓錯誤往外拋，只記錄 log。
  try {
    await createOrMergeNotification(db, {
      userId: receiver.id,
      type: "direct_share_received",
      payload: {
        itemId: item.id,
        itemTitle: item.title,
        itemOwnerNickname: user.profile.nickname,
      },
    });
  } catch (e) {
    console.error("createOrMergeNotification failed for direct_share_received", e);
  }

  return NextResponse.json({ id: created.id }, { status: 201 });
}
