import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { CreateRestrictionForm, LiftRestrictionRow } from "./restriction-panel";

export const metadata = { title: "使用者管理" };

const PAGE_SIZE = 20;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

const ROLE_LABEL: Record<string, string> = {
  user: "一般使用者",
  moderator: "審核人員",
  admin: "管理者",
};

// 後台使用者管理頁（master-plan §7 第 7 項）：moderator/admin 才能看，其餘一律 404
// （比照 /admin/support-tickets 現有的權限判斷寫法）。沒有現成的「使用者搜尋」API，
// 直接查 db（比照 /admin/items、/admin/support-tickets 既有的 server component 直接
// 查詢慣例）；實際建立／解除限制動作則呼叫既有的
// POST/DELETE /api/admin/user-restrictions[...]，不重寫那兩支 API 的邏輯。
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const actor = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!actor || !isModeratorOrAdmin(actor)) notFound();
  const isActorAdmin = actor.roles.some((r) => r.role === "admin");

  const { q, cursor } = await searchParams;
  const keyword = q?.trim() || undefined;

  const now = new Date();
  const where = keyword
    ? {
        OR: [
          { email: { contains: keyword, mode: "insensitive" as const } },
          { profile: { nickname: { contains: keyword, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const users = await db.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: { select: { nickname: true } },
      roles: { select: { role: true } },
      restrictions: {
        where: { liftedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: "desc" },
        select: { id: true, type: true, reason: true, expiresAt: true, createdAt: true },
      },
    },
  });
  const hasMore = users.length > PAGE_SIZE;
  const page = hasMore ? users.slice(0, PAGE_SIZE) : users;

  function filterHref(overrides: { cursor?: string }) {
    const qs = new URLSearchParams();
    if (keyword) qs.set("q", keyword);
    if (overrides.cursor) qs.set("cursor", overrides.cursor);
    const query = qs.toString();
    return `/admin/users${query ? `?${query}` : ""}`;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">使用者管理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">搜尋使用者，建立或解除功能限制／封鎖。</p>

      <div className="mt-6">
        <AdminNav current="/admin/users" />
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={keyword ?? ""}
          placeholder="依暱稱或 email 搜尋"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        <button
          type="submit"
          className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
        >
          搜尋
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {page.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            沒有符合條件的使用者
          </p>
        ) : (
          page.map((u) => {
            const targetIsAdmin = u.roles.some((r) => r.role === "admin");
            return (
              <div key={u.id} className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {u.profile?.nickname ?? "（尚未完成 onboarding）"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {u.email}・加入於 {TAIPEI_FORMATTER.format(u.createdAt)}
                    </p>
                    <Link
                      href={`/u/${u.id}`}
                      className="mt-1 inline-block text-xs text-brand-ink underline-offset-4 hover:underline"
                    >
                      查看公開個人頁
                    </Link>
                  </div>
                  <div className="flex gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.role} variant={r.role === "admin" ? "default" : "secondary"}>
                        {ROLE_LABEL[r.role] ?? r.role}
                      </Badge>
                    ))}
                  </div>
                </div>

                {u.restrictions.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3">
                    {u.restrictions.map((r) => (
                      <li key={r.id}>
                        <LiftRestrictionRow
                          restrictionId={r.id}
                          type={r.type}
                          reason={r.reason}
                          expiresAt={r.expiresAt}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 border-t border-line pt-3">
                  <CreateRestrictionForm
                    userId={u.id}
                    disabled={targetIsAdmin && !isActorAdmin}
                    disabledReason="審核人員不能限制管理者帳號"
                  />
                </div>
              </div>
            );
          })
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
