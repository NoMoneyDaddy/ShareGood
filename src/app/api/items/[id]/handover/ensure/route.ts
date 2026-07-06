import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// POST /api/items/[id]/handover/ensure — 懶建立交接（idempotent）。
//
// 設計理由（見 PR 說明）：Wave 1 的留言/認領（claims）與直贈（direct-shares）的 accept
// transaction 已經上線驗證過、不能再動。與其在那兩份檔案裡分別塞「建立 handover／conversation」
// 的邏輯（等於同一件事寫兩次、還要冒重新驗證既有流程的風險），這裡改用懶建立模式：
// 任何時候呼叫這支 API，只要物品已經 reserved 且呼叫者是物主或被接受的那個人，就把
// HandoverRecord／Conversation／雙方 ConversationMember 建起來，並把物品轉成
// handover_pending。之後不管呼叫幾次都是同一個結果（idempotent），前端「前往交接」
// 按鈕可以放心重複點擊或重整頁面。
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  // 已經建立過 handover（狀態已經是 handover_pending 或 completed）：直接回現有的
  // conversationId，不重新建立、也不報錯。
  if (item.status === "handover_pending" || item.status === "completed") {
    const [handover, conversation] = await Promise.all([
      db.handoverRecord.findUnique({ where: { itemId } }),
      db.conversation.findUnique({ where: { itemId } }),
    ]);
    if (!handover || !conversation) {
      return jsonError("CONFLICT", "交接資料異常，請聯絡客服");
    }
    if (user.id !== item.ownerId && user.id !== handover.receiverId) {
      return jsonError("FORBIDDEN", "只有物主或接手者可以查看這個交接");
    }
    return NextResponse.json({ conversationId: conversation.id });
  }

  if (item.status !== "reserved") {
    return jsonError("CONFLICT", "這個物品目前無法開始交接");
  }

  // 找出接手者：留言/認領與直贈這兩條路徑只會有一個有 accepted 資料（物品一旦 reserved，
  // 不可能兩條路徑都成功）。
  const [acceptedClaim, acceptedDirectShare] = await Promise.all([
    db.claimComment.findFirst({ where: { itemId, status: "accepted" } }),
    db.directShare.findFirst({ where: { itemId, status: "accepted" } }),
  ]);
  const receiverId = acceptedClaim?.userId ?? acceptedDirectShare?.receiverId;
  if (!receiverId) {
    return jsonError("CONFLICT", "找不到這個物品的接手者資料，請聯絡客服");
  }

  if (user.id !== item.ownerId && user.id !== receiverId) {
    return jsonError("FORBIDDEN", "只有物主或接手者可以開始交接");
  }

  const result = await db.$transaction(async (tx) => {
    // upsert 靠 itemId 的 unique constraint 在 DB 層原子處理，併發呼叫不會建立出兩筆。
    await tx.handoverRecord.upsert({
      where: { itemId },
      create: { itemId, receiverId },
      update: {},
    });
    const conversation = await tx.conversation.upsert({
      where: { itemId },
      create: { itemId },
      update: {},
    });
    // skipDuplicates 搭配 @@unique([conversationId, userId])：併發呼叫也不會重複建立成員。
    await tx.conversationMember.createMany({
      data: [
        { conversationId: conversation.id, userId: item.ownerId },
        { conversationId: conversation.id, userId: receiverId },
      ],
      skipDuplicates: true,
    });

    // 原子轉換物品狀態；併發呼叫只有一個會把 count 更新為 1，藉此判斷「這次呼叫是不是
    // 真正觸發狀態轉換的那一個」，只有它才寫入 ItemStatusLog。
    const updated = await tx.item.updateMany({
      where: { id: itemId, status: "reserved" },
      data: { status: "handover_pending" },
    });
    if (updated.count === 1) {
      await tx.itemStatusLog.create({
        data: {
          itemId,
          fromStatus: "reserved",
          toStatus: "handover_pending",
          actorId: user.id,
        },
      });
    }

    return { conversationId: conversation.id };
  });

  return NextResponse.json(result);
}
