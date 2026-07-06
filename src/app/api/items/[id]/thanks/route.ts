import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// POST /api/items/[id]/thanks — 接手者留感謝訊息給物主（單向，接手者 → 物主；一個
// 物品限一則感謝留言）。
//
// 防重複機制刻意比 Wave 1/2（留言搶認領、handover complete/no-show）簡化：那些是
// updateMany where + count 的原子交易級併發防護，因為關係到狀態機轉換（誰先搶到、
// 貢獻值該不該記分）。這裡用的是簡單的 findFirst-then-create：ThanksMessage 本身
// 沒有 unique constraint、也不驅動任何狀態轉換或記分（貢獻值完全在 complete/no-show
// 那兩支 API 裡處理，跟這支 API 無關），極端併發下最壞結果只是同一物品出現兩則感謝
// 留言，不會造成資料錯誤，故不需要 Wave 1/2 那種等級的原子保護。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { handoverRecord: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  if (item.status !== "completed") {
    return jsonError("CONFLICT", "這個物品還沒完成分享，無法留言感謝");
  }

  if (item.handoverRecord?.receiverId !== user.id) {
    return jsonError("FORBIDDEN", "只有接手者可以留言感謝");
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > 300) {
    return jsonError("UNPROCESSABLE", "感謝留言需為 1–300 個字");
  }

  const existing = await db.thanksMessage.findFirst({ where: { itemId } });
  if (existing) {
    return jsonError("CONFLICT", "已經留過感謝了");
  }

  const created = await db.thanksMessage.create({
    data: { itemId, fromUserId: user.id, toUserId: item.ownerId, message },
    select: { id: true, message: true, createdAt: true },
  });

  // NotificationType 沒有專屬的「收到感謝」類型；重用 completion_confirmed——語意上都是
  // 「這筆分享圓滿收尾」的通知，額外在 payload 帶 thanksMessage，讓之後想做通知詳情頁時
  // 能分辨這則是連帶感謝訊息的完成通知。
  await db.notification.create({
    data: {
      userId: item.ownerId,
      type: "completion_confirmed",
      payload: { itemId: item.id, itemTitle: item.title, thanksMessage: message },
    },
  });

  return NextResponse.json(created, { status: 201 });
}
