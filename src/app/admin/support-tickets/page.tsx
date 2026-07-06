import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import type { SupportTicketStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  isModeratorOrAdmin,
  SUPPORT_TICKET_CATEGORY_LABEL,
  SUPPORT_TICKET_STATUS_LABEL,
} from "@/lib/support-tickets";
import { cn } from "@/lib/utils";
import { AdminNav } from "../admin-nav";

export const metadata = { title: "使用者回報處理" };

const PAGE_SIZE = 20;

const STATUS_TABS: { value: SupportTicketStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "open", label: "待處理" },
  { value: "in_progress", label: "處理中" },
  { value: "resolved", label: "已解決" },
  { value: "closed", label: "已結案" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "secondary",
  resolved: "outline",
  closed: "outline",
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

function isValidStatusFilter(value: string | undefined): value is SupportTicketStatus {
  return !!value && value in SUPPORT_TICKET_STATUS_LABEL;
}

// 後台使用者回報處理列表（master-plan §7 交付內容 5＋7）：moderator/admin 才能看，其餘
// 一律 404（不透露這個頁面存在，比照既有 API 慣例）。完整 `/admin` 殼（總覽、導覽、其餘
// 治理功能）已經在任務 7 補上，這裡掛上共用的 AdminNav 讓這頁不再是自成一格的孤兒頁。
export default async function AdminSupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; assigned?: string; cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const { status, assigned, cursor } = await searchParams;
  const statusFilter = isValidStatusFilter(status) ? status : undefined;
  const assignedFilter = assigned === "me" || assigned === "unassigned" ? assigned : undefined;

  const where = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(assignedFilter === "me" ? { assignedTo: user.id } : {}),
    ...(assignedFilter === "unassigned" ? { assignedTo: null } : {}),
  };

  const tickets = await db.supportTicket.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      category: true,
      subject: true,
      status: true,
      createdAt: true,
      user: { select: { profile: { select: { nickname: true } } } },
      assignee: { select: { id: true, profile: { select: { nickname: true } } } },
    },
  });
  const hasMore = tickets.length > PAGE_SIZE;
  const page = hasMore ? tickets.slice(0, PAGE_SIZE) : tickets;

  function tabHref(value: string) {
    const qs = new URLSearchParams();
    if (value !== "all") qs.set("status", value);
    if (assignedFilter) qs.set("assigned", assignedFilter);
    const query = qs.toString();
    return `/admin/support-tickets${query ? `?${query}` : ""}`;
  }

  function assignedHref(value: "me" | "unassigned" | null) {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (value) qs.set("assigned", value);
    const query = qs.toString();
    return `/admin/support-tickets${query ? `?${query}` : ""}`;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">使用者回報處理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">bug 與帳號問題回報的後台處理列表。</p>

      <div className="mt-6">
        <AdminNav current="/admin/support-tickets" />
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="依狀態篩選">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabHref(tab.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              (statusFilter ?? "all") === tab.value
                ? "border-brand bg-brand/10 font-medium text-brand-ink"
                : "border-line text-ink-soft hover:bg-paper-2",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <nav className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="依認領狀態篩選">
        <Link
          href={assignedHref(null)}
          className={cn(
            "underline-offset-4",
            !assignedFilter ? "font-medium text-ink" : "text-ink-soft hover:underline",
          )}
        >
          全部
        </Link>
        <Link
          href={assignedHref("me")}
          className={cn(
            "underline-offset-4",
            assignedFilter === "me" ? "font-medium text-ink" : "text-ink-soft hover:underline",
          )}
        >
          指派給我
        </Link>
        <Link
          href={assignedHref("unassigned")}
          className={cn(
            "underline-offset-4",
            assignedFilter === "unassigned"
              ? "font-medium text-ink"
              : "text-ink-soft hover:underline",
          )}
        >
          尚未認領
        </Link>
      </nav>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">目前沒有符合條件的回報</p>
        ) : (
          <ul>
            {page.map((t, index) => (
              <li key={t.id} className={cn(index > 0 && "border-t border-line")}>
                <Link
                  href={`/support/${t.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-paper-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {SUPPORT_TICKET_CATEGORY_LABEL[t.category] ?? t.category}・
                      {t.user.profile?.nickname ?? "好物共享用戶"}・
                      {TAIPEI_FORMATTER.format(t.createdAt)}
                      {t.assignee && `・負責人：${t.assignee.profile?.nickname ?? "好物共享用戶"}`}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>
                    {SUPPORT_TICKET_STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/support-tickets?${new URLSearchParams({
              ...(statusFilter ? { status: statusFilter } : {}),
              ...(assignedFilter ? { assigned: assignedFilter } : {}),
              cursor: page[page.length - 1].id,
            }).toString()}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
