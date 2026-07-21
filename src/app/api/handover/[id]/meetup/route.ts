import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { parseScheduledAtInput } from "@/lib/handover-meetup";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/handover/[id]/meetup — M12 交付內容 5（面交約定時間，
// docs/plan/m12-product-growth.md）：交接對話任一方可設定/修改/清空約定面交時間，
// 不需要雙方確認（低風險的輔助提醒工具，不是交接的強制關卡）。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const isOwner = user.id === handover.item.ownerId;
  const isReceiver = user.id === handover.receiverId;
  if (!isOwner && !isReceiver) {
    return jsonError("FORBIDDEN", "只有物主或接手者可以設定這筆交接的約定時間");
  }

  // 僅 pending 狀態可修改：已完成/已標記未出現的交接沒有再約時間的意義。
  if (handover.status !== "pending") {
    return jsonError("CONFLICT", "這筆交接已經處理過了，無法再設定約定時間");
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("scheduledAt" in body)) {
    return jsonError("UNPROCESSABLE", "請提供約定時間（或傳 null 清空）");
  }

  const parsed = parseScheduledAtInput((body as Record<string, unknown>).scheduledAt);
  if (!parsed.ok) {
    return jsonError("UNPROCESSABLE", parsed.message);
  }

  // 帶 status: "pending" 條件的 updateMany 當樂觀鎖：如果在讀到 handover 之後、這次寫入
  // 之前，交接剛好被另一個請求標記完成/未出現，count 會是 0，代表這次修改已經沒有意義。
  //
  // **關鍵**：不論這次是設定新時間、修改既有時間、還是清空，都無條件把 reminderSentAt
  // 重設為 null——否則提醒 job 會因為舊的「已提醒」標記，對新的約定時間狀態永遠不再提醒
  // （見 prisma/schema.prisma HandoverRecord.reminderSentAt 欄位註解、
  // docs/plan/m12-product-growth.md 交付內容 5「實作注意」）。
  const updated = await db.handoverRecord.updateMany({
    where: { id: handoverId, status: "pending" },
    data: { scheduledAt: parsed.value, reminderSentAt: null },
  });
  if (updated.count === 0) {
    return jsonError("CONFLICT", "這筆交接已經處理過了，無法再設定約定時間");
  }

  return NextResponse.json({ scheduledAt: parsed.value ? parsed.value.toISOString() : null });
}
