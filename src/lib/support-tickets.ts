import type { SupportTicketStatus } from "@/generated/prisma/enums";

type RoleBearer = { roles: { role: string }[] };

/** 是否具備 moderator 或 admin 角色（admin 隱含 moderator 權限，跟 requireRole 的邏輯一致）。 */
export function isModeratorOrAdmin(user: RoleBearer): boolean {
  return user.roles.some((r) => r.role === "moderator" || r.role === "admin");
}

/** 本人或 moderator/admin 才算「有權限看這張 ticket」（供 API route 與 /support/[id] 頁面共用）。 */
export function canViewSupportTicket(
  ticket: { userId: string },
  user: { id: string } & RoleBearer,
): boolean {
  if (ticket.userId === user.id) return true;
  return isModeratorOrAdmin(user);
}

// 狀態機（master-plan §7：「open → in_progress → resolved/closed」）：只能往前走，
// resolved/closed 是終態。允許從 open 跳過 in_progress 直接到 resolved/closed，見
// src/app/api/support-tickets/[id]/events/route.ts 的說明。
export const ALLOWED_STATUS_TRANSITIONS: Record<
  SupportTicketStatus,
  readonly SupportTicketStatus[]
> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

export const SUPPORT_TICKET_CATEGORY_LABEL: Record<string, string> = {
  bug: "功能異常",
  account: "帳號問題",
  other: "其他",
};

export const SUPPORT_TICKET_STATUS_LABEL: Record<string, string> = {
  open: "待處理",
  in_progress: "處理中",
  resolved: "已解決",
  closed: "已結案",
};
