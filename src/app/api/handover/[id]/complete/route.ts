import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { CONTRIBUTION_POINTS } from "@/lib/contribution";
import { db } from "@/lib/db";
import { createOrMergeNotification } from "@/lib/notifications";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/handover/[id]/complete — 物主或接手者標記「我這邊完成了」。
// 雙方都確認後才真正轉 completed；整段判斷與寫入包在同一個 $transaction 裡，比照
// Wave 1 直贈/留言那邊已經驗證過的「原子搶佔＋updateMany count 判斷」模式，確保雙方
// 幾乎同時各自呼叫時，只有一次會真的觸發「轉 completed」的寫入。
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: handoverId } = await params;
  const handover = await db.handoverRecord.findUnique({
    where: { id: handoverId },
    include: { item: { select: { id: true, ownerId: true, title: true } } },
  });
  if (!handover) return jsonError("NOT_FOUND", "找不到這筆交接紀錄");

  const isOwner = user.id === handover.item.ownerId;
  const isReceiver = user.id === handover.receiverId;
  if (!isOwner && !isReceiver) {
    return jsonError("FORBIDDEN", "只有物主或接手者可以標記這筆交接完成");
  }

  if (handover.status === "no_show") {
    return jsonError("CONFLICT", "這筆交接已經標記為對方未出現，無法再標記完成");
  }

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    // updateMany 帶「自己那欄還是 null」＋「status 還是 pending」的條件：自己已經確認過
    // 就不會再更新一次（idempotent），也不會報錯；多帶 status: "pending" 是為了關掉一個
    // 時間差——外層的 no_show 檢查讀的是進 transaction 之前的資料，如果另一個併發請求
    // 幾乎同時把這筆交接標記成 no_show，這裡的 updateMany 條件會讓 count 變 0，不會在
    // 已經 no_show 的紀錄上誤寫確認時間。單一 UPDATE 陳述式本身是原子的，兩個併發請求
    // 即使同時打進來，也只有一個會真的把值寫進去，另一個 count 會是 0。
    if (isOwner) {
      await tx.handoverRecord.updateMany({
        where: { id: handoverId, ownerConfirmedAt: null, status: "pending" },
        data: { ownerConfirmedAt: now },
      });
    } else {
      await tx.handoverRecord.updateMany({
        where: { id: handoverId, receiverConfirmedAt: null, status: "pending" },
        data: { receiverConfirmedAt: now },
      });
    }

    const current = await tx.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });

    if (current.ownerConfirmedAt && current.receiverConfirmedAt && current.status !== "completed") {
      const flipped = await tx.handoverRecord.updateMany({
        where: { id: handoverId, status: "pending" },
        data: { status: "completed", completedAt: now },
      });
      if (flipped.count === 1) {
        await tx.item.updateMany({
          where: { id: handover.item.id, status: "handover_pending" },
          data: { status: "completed" },
        });
        await tx.itemStatusLog.create({
          data: {
            itemId: handover.item.id,
            fromStatus: "handover_pending",
            toStatus: "completed",
            actorId: user.id,
          },
        });
        await createOrMergeNotification(tx, {
          userId: handover.item.ownerId,
          type: "completion_confirmed",
          payload: { itemId: handover.item.id, itemTitle: handover.item.title },
        });
        await createOrMergeNotification(tx, {
          userId: handover.receiverId,
          type: "completion_confirmed",
          payload: { itemId: handover.item.id, itemTitle: handover.item.title },
        });
        // 貢獻值記分：塞在 flipped.count === 1 這個「恰好只會發生一次」的分支裡，借用上面
        // updateMany + count 判斷的原子保護，確保雙方各自呼叫或其中一方重複呼叫 complete
        // 都不會重複記分。
        await tx.contributionEvent.createMany({
          data: [
            {
              userId: handover.item.ownerId,
              itemId: handover.item.id,
              type: "share_completed",
              points: CONTRIBUTION_POINTS.share_completed,
            },
            {
              userId: handover.receiverId,
              itemId: handover.item.id,
              type: "receive_completed",
              points: CONTRIBUTION_POINTS.receive_completed,
            },
          ],
        });
        return { ...current, status: "completed" as const, completedAt: now };
      }
    }

    return current;
  });

  return NextResponse.json({
    id: result.id,
    status: result.status,
    ownerConfirmedAt: result.ownerConfirmedAt,
    receiverConfirmedAt: result.receiverConfirmedAt,
    completedAt: result.completedAt,
  });
}
