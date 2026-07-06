import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// 已經是終態的物品不能再被強制下架：已完成分享、已到期、已被物主自行下架、
// 或已經被強制下架過（避免同一物品重複轉態、重複寫 ItemRemoval/AuditLog）。
const TERMINAL_STATUSES = new Set([
  "completed",
  "expired",
  "removed_by_user",
  "removed_by_moderator",
]);

// PATCH /api/items/[id]/force-remove — moderator/admin 強制下架物品（master-plan §7）。
//
// 併發安全：跟 no-show／handover ensure 同一套「原子 updateMany + count」慣例，差別是
// 這裡允許的「起始狀態」不是單一值，而是任何非終態（draft/pending_review/published/
// reserved/handover_pending 都可能被下架）。做法：先讀一次目前狀態，若已是終態直接 409；
// 否則用「讀到的那個狀態」當 updateMany 的 where 條件原子轉態，count === 0 代表這中間
// 被別的請求搶先轉走了（例如同時被兩個 moderator 下架、或物主剛好完成交接），一樣回 409，
// 不會出現兩筆 ItemRemoval 或重複通知。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let moderator: Awaited<ReturnType<typeof requireRole>>;
  try {
    moderator = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const { id: itemId } = await params;

  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (reason.length < 1 || reason.length > 500) {
    return jsonError("UNPROCESSABLE", "下架原因為必填，需為 1–500 個字");
  }
  if (note.length > 1000) {
    return jsonError("UNPROCESSABLE", "備註最多 1000 個字");
  }

  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, ownerId: true, title: true, status: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  if (TERMINAL_STATUSES.has(item.status)) {
    return jsonError("CONFLICT", "這個物品目前的狀態無法下架");
  }

  const result = await db.$transaction(async (tx) => {
    const flipped = await tx.item.updateMany({
      where: { id: itemId, status: item.status },
      data: { status: "removed_by_moderator" },
    });
    if (flipped.count === 0) {
      return { ok: false as const };
    }

    await tx.itemStatusLog.create({
      data: {
        itemId,
        fromStatus: item.status,
        toStatus: "removed_by_moderator",
        actorId: moderator.id,
        reason,
      },
    });

    const removal = await tx.itemRemoval.create({
      data: { itemId, moderatorId: moderator.id, reason, note: note || null },
      select: { id: true, createdAt: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: moderator.id,
        action: "item.force_remove",
        targetType: "item",
        targetId: itemId,
        detail: { reason, note: note || null, itemRemovalId: removal.id },
        sensitive: false,
      },
    });

    // 通知物主：master-plan §7 沒有替「強制下架」新增專屬 NotificationType，這裡刻意
    // 不改 schema，複用既有的 handover_message 類型（同樣是「物品有新進展要去看一下」的
    // 語意，比起 claim_accepted / completion_confirmed 這種正面用語誤導性更低），並在
    // payload 帶 kind: "item_force_removed" 讓前端（src/app/notifications/page.tsx）
    // 精準改寫文案，不受 type 本身文字影響；之後如果真的要拆專屬 type，只要那裡的
    // describeNotification 邏輯調整即可，不影響這裡的資料寫入。
    await tx.notification.create({
      data: {
        userId: item.ownerId,
        type: "handover_message",
        payload: {
          kind: "item_force_removed",
          itemId,
          itemTitle: item.title,
          reason,
        },
      },
    });

    return { ok: true as const, removalId: removal.id, createdAt: removal.createdAt };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "這個物品剛好被其他操作轉走了狀態，請重新整理後再試");
  }

  return NextResponse.json({
    status: "removed_by_moderator",
    removalId: result.removalId,
    createdAt: result.createdAt,
  });
}
