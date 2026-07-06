import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

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

    await tx.item.updateMany({
      where: { id: handover.item.id, status: "handover_pending" },
      data: { status: "published" },
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

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "這筆交接已經處理過了");
  }

  return NextResponse.json({ status: "no_show" });
}
