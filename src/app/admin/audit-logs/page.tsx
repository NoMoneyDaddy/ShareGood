import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";

export const metadata = { title: "稽核紀錄" };

const PAGE_SIZE = 30;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "medium",
});

const TARGET_TYPE_OPTIONS = ["item", "user", "report", "appeal", "support_ticket"];

// 後台稽核紀錄查詢頁（master-plan §7 第 7 項）：moderator/admin 才能看，其餘一律 404
// （比照 /admin/support-tickets 現有的權限判斷寫法）。純唯讀查詢，沒有現成的 API，直接
// 查 db（比照 /admin/items、/admin/users 既有的 server component 直接查詢慣例）。
// audit_logs 目前的兩條索引（actorId+createdAt、targetType+targetId+createdAt，見
// prisma/schema.prisma）剛好對應這裡最常見的兩種查法：依 targetType 篩選＋預設 createdAt
// 排序（走第二條索引），不帶篩選時走 createdAt 由 id 當 tie-breaker（沒有專屬索引，
// 但 audit_logs 量體在 M2 階段還小，等成長到需要優化時再加）。
export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ targetType?: string; targetId?: string; cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const { targetType, targetId, cursor } = await searchParams;
  const targetTypeFilter =
    targetType && TARGET_TYPE_OPTIONS.includes(targetType) ? targetType : undefined;
  const targetIdFilter = targetId?.trim() || undefined;

  const where = {
    ...(targetTypeFilter ? { targetType: targetTypeFilter } : {}),
    ...(targetIdFilter ? { targetId: targetIdFilter } : {}),
  };

  const logs = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      detail: true,
      sensitive: true,
      createdAt: true,
      actor: { select: { id: true, profile: { select: { nickname: true } } } },
    },
  });
  const hasMore = logs.length > PAGE_SIZE;
  const page = hasMore ? logs.slice(0, PAGE_SIZE) : logs;

  function filterHref(overrides: { cursor?: string }) {
    const qs = new URLSearchParams();
    if (targetTypeFilter) qs.set("targetType", targetTypeFilter);
    if (targetIdFilter) qs.set("targetId", targetIdFilter);
    if (overrides.cursor) qs.set("cursor", overrides.cursor);
    const query = qs.toString();
    return `/admin/audit-logs${query ? `?${query}` : ""}`;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">稽核紀錄</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        所有管理操作（actor／action／target／時間）唯讀查詢。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/audit-logs" />
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <select
          name="targetType"
          defaultValue={targetTypeFilter ?? ""}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">全部對象類型</option>
          {TARGET_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="targetId"
          defaultValue={targetIdFilter ?? ""}
          placeholder="依 target id 精確查詢"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        <button
          type="submit"
          className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
        >
          搜尋
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">沒有符合條件的稽核紀錄</p>
        ) : (
          <ul>
            {page.map((log, index) => (
              <li
                key={log.id}
                className={index > 0 ? "border-t border-line px-4 py-3" : "px-4 py-3"}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{log.action}</p>
                  <div className="flex items-center gap-2">
                    {log.sensitive && <Badge variant="destructive">敏感</Badge>}
                    <span className="text-xs text-ink-soft">
                      {TAIPEI_FORMATTER.format(log.createdAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  操作者：{log.actor?.profile?.nickname ?? log.actor?.id ?? "系統"}・對象：
                  {log.targetType}
                  {log.targetId ? `（${log.targetId}）` : ""}
                </p>
                {log.detail !== null && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-2 px-2 py-1.5 text-[11px] text-ink-soft">
                    {JSON.stringify(log.detail)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={filterHref({ cursor: page[page.length - 1].id })}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
