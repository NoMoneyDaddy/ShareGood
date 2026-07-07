import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/storage";
import {
  ALLOWED_STATUS_TRANSITIONS,
  canViewSupportTicket,
  isModeratorOrAdmin,
  SUPPORT_TICKET_CATEGORY_LABEL,
  SUPPORT_TICKET_STATUS_LABEL,
} from "@/lib/support-tickets";
import { AssignButton } from "./assign-button";
import { TicketActions } from "./ticket-actions";

export const metadata = { title: "回報詳情" };

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "secondary",
  resolved: "outline",
  closed: "outline",
};

// 回報詳情頁（master-plan §7 交付內容 5）：本人與 moderator/admin 都能看，本頁同時扮演
// 「使用者查看自己回報進度」與「後台單張處理」兩種角色的介面——moderator/admin 額外看到
// 認領按鈕與狀態轉換按鈕，一般使用者只看到留言跟進表單。權限判斷與 API 共用
// src/lib/support-tickets.ts 的 canViewSupportTicket，不重複寫一份邏輯。
export default async function SupportTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: true, profile: true },
  });
  if (!user) redirect("/");

  const { id } = await params;
  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, profile: { select: { nickname: true } } } },
      assignee: { select: { id: true, profile: { select: { nickname: true } } } },
      attachments: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, storageObject: { select: { objectKey: true } } },
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

  // 跟 GET /api/support-tickets/[id] 一致：非本人、非 moderator/admin 一律 404，
  // 不透露這張 ticket 是否存在。
  if (!ticket || !canViewSupportTicket(ticket, user)) notFound();

  const canModerate = isModeratorOrAdmin(user);
  const allowedTransitions = canModerate
    ? ALLOWED_STATUS_TRANSITIONS[ticket.status].map((value) => ({
        value,
        label: SUPPORT_TICKET_STATUS_LABEL[value] ?? value,
      }))
    : [];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-soft">
            {SUPPORT_TICKET_CATEGORY_LABEL[ticket.category] ?? ticket.category}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{ticket.subject}</h1>
        </div>
        <Badge variant={STATUS_VARIANT[ticket.status] ?? "outline"}>
          {SUPPORT_TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
        </Badge>
      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>

      {ticket.attachments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {ticket.attachments.map((a) => (
            <a
              key={a.id}
              href={publicUrl(a.storageObject.objectKey)}
              target="_blank"
              rel="noreferrer"
              className="block h-20 w-20 overflow-hidden rounded-lg border border-line"
            >
              <Image
                src={publicUrl(a.storageObject.objectKey)}
                alt="回報附件截圖"
                width={80}
                height={80}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-soft">
        由 {ticket.user.profile?.nickname ?? "好物共享用戶"} 於{" "}
        {TAIPEI_FORMATTER.format(ticket.createdAt)} 提出
      </p>

      {canModerate && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
          <span>
            目前負責人：
            {ticket.assignee ? (ticket.assignee.profile?.nickname ?? "好物共享用戶") : "尚未認領"}
          </span>
          <AssignButton
            ticketId={ticket.id}
            currentUserId={user.id}
            isAssignedToMe={ticket.assignee?.id === user.id}
            hasAssignee={!!ticket.assignee}
          />
        </div>
      )}

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-lg font-bold tracking-tight">處理紀錄</h2>
        {ticket.events.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">還沒有留言</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {ticket.events.map((e) => (
              <li key={e.id} className="rounded-xl border border-line bg-card p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {e.actor?.profile?.nickname ?? "好物共享用戶"}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {TAIPEI_FORMATTER.format(e.createdAt)}
                  </span>
                </div>
                {e.toStatus && (
                  <p className="mt-1 text-xs font-medium text-brand-ink">
                    轉換狀態為「{SUPPORT_TICKET_STATUS_LABEL[e.toStatus] ?? e.toStatus}」
                  </p>
                )}
                {e.message && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{e.message}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <TicketActions
          ticketId={ticket.id}
          allowedTransitions={allowedTransitions}
          canModerate={canModerate}
        />
      </section>
    </div>
  );
}
