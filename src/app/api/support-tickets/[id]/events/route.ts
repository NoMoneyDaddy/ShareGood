import { type NextRequest, NextResponse } from "next/server";
import type { SupportTicketStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { ALLOWED_STATUS_TRANSITIONS, isModeratorOrAdmin } from "@/lib/support-tickets";

const STATUSES: readonly SupportTicketStatus[] = ["open", "in_progress", "resolved", "closed"];

function isStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// POST /api/support-tickets/[id]/events — 本人或 moderator/admin 留言跟進；
// moderator/admin 可以順便把 toStatus 帶上做狀態轉換（純留言 fromStatus/toStatus 皆
// null，見 SupportTicketEvent model 註解）。非本人/非 moderator/admin 一律 404
// （沿用 GET /api/support-tickets/[id] 的判斷，見該檔案註解）。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({ where: { id } });
  const modOrAdmin = isModeratorOrAdmin(user);
  if (!ticket || (ticket.userId !== user.id && !modOrAdmin)) {
    return jsonError("NOT_FOUND", "找不到這個回報");
  }

  const body = await req.json().catch(() => null);
  const rawMessage = body?.message;
  const message = typeof rawMessage === "string" ? rawMessage.trim() : null;
  if (
    rawMessage !== undefined &&
    rawMessage !== null &&
    message !== null &&
    message.length > 1000
  ) {
    return jsonError("UNPROCESSABLE", "留言需在 1000 個字以內");
  }
  const hasMessage = message !== null && message.length > 0;

  const rawToStatus = body?.toStatus;
  if (rawToStatus !== undefined && rawToStatus !== null) {
    if (!isModeratorOrAdmin(user)) {
      return jsonError("FORBIDDEN", "只有 moderator/admin 可以轉換狀態");
    }
    if (!isStatus(rawToStatus)) {
      return jsonError("UNPROCESSABLE", "toStatus 無效");
    }
  }
  const toStatus: SupportTicketStatus | null = isStatus(rawToStatus) ? rawToStatus : null;

  if (!hasMessage && !toStatus) {
    return jsonError("UNPROCESSABLE", "留言與狀態轉換至少要有一項");
  }

  try {
    const event = await db.$transaction(async (tx) => {
      let fromStatus: SupportTicketStatus | null = null;

      if (toStatus) {
        const current = ticket.status;
        if (!ALLOWED_STATUS_TRANSITIONS[current].includes(toStatus)) {
          throw new Error("INVALID_TRANSITION");
        }
        // 跟 claims/items 同一招：where 帶目前狀態，事務內原子更新，避免兩個
        // moderator 併發轉換同一張 ticket 造成不一致。
        const updated = await tx.supportTicket.updateMany({
          where: { id, status: current },
          data: { status: toStatus },
        });
        if (updated.count !== 1) {
          throw new Error("STALE_STATUS");
        }
        fromStatus = current;

        // 狀態轉換屬於管理操作，寫 audit log（master-plan §7 驗收清單：「每個管理操作在
        // audit_logs 有紀錄」）；單純留言不算管理操作，不寫。
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "support_ticket.status_change",
            targetType: "support_ticket",
            targetId: id,
            detail: { fromStatus, toStatus },
            sensitive: false,
          },
        });
      }

      return tx.supportTicketEvent.create({
        data: {
          ticketId: id,
          actorId: user.id,
          fromStatus,
          toStatus,
          message: hasMessage ? message : null,
        },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          message: true,
          createdAt: true,
        },
      });
    });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_TRANSITION") {
      return jsonError("CONFLICT", "這個狀態轉換不允許");
    }
    if (err instanceof Error && err.message === "STALE_STATUS") {
      return jsonError("CONFLICT", "這張回報的狀態已被其他人變更，請重新整理");
    }
    throw err;
  }
}
