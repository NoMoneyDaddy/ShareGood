import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { CONTRIBUTION_POINTS } from "@/lib/contribution";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/handover/[id]/no-show — 物主標記「被接受者沒有出現」。
//
// master-plan 原文沒有明講 no_show 之後物品狀態要變什麼；這裡的判斷是把物品狀態退回
// published（讓物主可以重新找人接手），理由：no_show 代表這次交接失敗，但物品本身還在、
// 也還能分享，直接讓它回到「可以被留言/直贈」的狀態最合理，好過讓它卡在 handover_pending
// 或直接變成不可逆的下架。詳見 PR 說明。
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
    include: { item: { select: { id: true, ownerId: true } } },
  });
  if (!handover) return jsonError("NOT_FOUND", "找不到這筆交接紀錄");

  if (user.id !== handover.item.ownerId) {
    return jsonError("FORBIDDEN", "只有物主可以標記對方未出現");
  }

  if (handover.status !== "pending") {
    const message =
      handover.status === "completed" ? "這筆交接已經完成，無法標記未出現" : "這筆交接已經處理過了";
    return jsonError("CONFLICT", message);
  }

  const result = await db.$transaction(async (tx) => {
    // updateMany 帶 status: "pending" 條件，原子性地確保只有一個請求能真的把它標記成
    // no_show（防止重複點擊或併發請求重複觸發物品狀態轉換）。
    const flipped = await tx.handoverRecord.updateMany({
      where: { id: handoverId, status: "pending" },
      data: { status: "no_show" },
    });
    if (flipped.count === 0) {
      return { ok: false as const };
    }

    // publishedAt 重蓋成現在：master-plan §6a M6 訂閱通知比對 job 用 (publishedAt, id) 當
    // cursor 掃描新上架物品，物品從 handover_pending 退回 published 若不更新 publishedAt，
    // 舊時間點會小於 cursor 已經前進的位置，導致這次「重新上架」永遠不會被訂閱比對 job 掃到。
    // 副作用是物品也會在前台列表重新置頂，符合「重新開放」的直覺預期。
    await tx.item.updateMany({
      where: { id: handover.item.id, status: "handover_pending" },
      data: { status: "published", publishedAt: new Date() },
    });
    await tx.itemStatusLog.create({
      data: {
        itemId: handover.item.id,
        fromStatus: "handover_pending",
        toStatus: "published",
        actorId: user.id,
        reason: "no_show",
      },
    });

    // 貢獻值記分：跟上面 item.updateMany 一樣，只會在 flipped.count > 0（也就是這次呼叫
    // 真的把它從 pending 轉成 no_show）時執行到，同一筆交接重複呼叫會被外層的 409 擋掉，
    // 不會重複扣分。扣分對象是接手者（沒有出現的人），不是物主。
    await tx.contributionEvent.create({
      data: {
        userId: handover.receiverId,
        itemId: handover.item.id,
        type: "no_show",
        points: CONTRIBUTION_POINTS.no_show,
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "這筆交接已經處理過了");
  }

  return NextResponse.json({ status: "no_show" });
}
