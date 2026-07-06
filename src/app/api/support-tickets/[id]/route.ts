import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/storage";
import { canViewSupportTicket, isModeratorOrAdmin } from "@/lib/support-tickets";

// GET /api/support-tickets/[id] — ticket 細節＋SupportTicketEvent 時間軸。
// 非本人、非 moderator/admin 一律回 404（比照 conversation 非參與者讀取的既有慣例，見
// src/app/api/conversations/[id]/messages/route.ts：連「這張 ticket 存在」都不透露，
// 不用 403，避免非相關使用者靠 404/403 的差異去枚舉別人的 ticket id）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, profile: { select: { nickname: true } } } },
      assignee: { select: { id: true, profile: { select: { nickname: true } } } },
      attachments: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true, storageObject: { select: { objectKey: true } } },
      },
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          message: true,
          createdAt: true,
          actor: { select: { id: true, profile: { select: { nickname: true } } } },
        },
      },
    },
  });
  if (!ticket || !canViewSupportTicket(ticket, user)) {
    return jsonError("NOT_FOUND", "找不到這個回報");
  }

  return NextResponse.json({
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    user: { id: ticket.user.id, nickname: ticket.user.profile?.nickname ?? "好物共享用戶" },
    assignee: ticket.assignee
      ? { id: ticket.assignee.id, nickname: ticket.assignee.profile?.nickname ?? "好物共享用戶" }
      : null,
    attachments: ticket.attachments.map((a) => ({
      id: a.id,
      sortOrder: a.sortOrder,
      url: publicUrl(a.storageObject.objectKey),
    })),
    events: ticket.events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      message: e.message,
      createdAt: e.createdAt,
      actor: e.actor
        ? { id: e.actor.id, nickname: e.actor.profile?.nickname ?? "好物共享用戶" }
        : null,
    })),
  });
}

// PATCH /api/support-tickets/[id] — moderator/admin 指派／取消指派負責人（後台處理列表用：
// 讓每個 moderator 能認領一張 ticket，避免多人重複處理同一張）。不動 SupportTicketEvent 的
// 既有欄位（fromStatus/toStatus 仍只給狀態機轉換用），改用 message 純留言記一筆「指派變更」
// 事件，讓 GET 這支既有的時間軸仍能完整重演誰在何時把 ticket 指派給誰，不用另外查表。
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

  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({ where: { id } });
  if (!ticket) return jsonError("NOT_FOUND", "找不到這個回報");

  const body = await req.json().catch(() => null);
  if (!body || !("assigneeId" in body)) {
    return jsonError("UNPROCESSABLE", "缺少 assigneeId（可傳 null 取消指派）");
  }
  const assigneeId: string | null = typeof body.assigneeId === "string" ? body.assigneeId : null;
  if (body.assigneeId !== null && typeof body.assigneeId !== "string") {
    return jsonError("UNPROCESSABLE", "assigneeId 需為字串或 null");
  }

  let assigneeNickname: string | null = null;
  if (assigneeId) {
    const assignee = await db.user.findUnique({
      where: { id: assigneeId },
      include: { roles: true, profile: true },
    });
    if (!assignee || !isModeratorOrAdmin(assignee)) {
      return jsonError("UNPROCESSABLE", "只能指派給 moderator 或 admin 帳號");
    }
    assigneeNickname = assignee.profile?.nickname ?? "好物共享用戶";
  }

  const message = assigneeId
    ? `已指派給 ${assigneeNickname}`
    : ticket.assignedTo
      ? "已取消指派"
      : null;

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.supportTicket.update({
      where: { id },
      data: { assignedTo: assigneeId },
      select: { id: true, assignedTo: true },
    });

    if (message) {
      await tx.supportTicketEvent.create({
        data: { ticketId: id, actorId: moderator.id, message },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: moderator.id,
        action: "support_ticket.assign",
        targetType: "support_ticket",
        targetId: id,
        detail: { assigneeId },
        sensitive: false,
      },
    });

    return result;
  });

  return NextResponse.json({ id: updated.id, assignedTo: updated.assignedTo });
}
