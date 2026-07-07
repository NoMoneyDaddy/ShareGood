import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import type { ItemStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { ForceRemoveForm } from "./force-remove-form";

export const metadata = { title: "物品管理" };

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "待審核",
  published: "上架中",
  reserved: "已被搶先留言",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已到期",
  removed_by_user: "物主自行下架",
  removed_by_moderator: "已被強制下架",
};

// 跟 src/app/api/items/[id]/force-remove/route.ts 的 TERMINAL_STATUSES 保持一致：
// 只有還沒走到終態的物品才能被強制下架。
const TERMINAL_STATUSES = new Set([
  "completed",
  "expired",
  "removed_by_user",
  "removed_by_moderator",
]);

const STATUS_OPTIONS = Object.keys(STATUS_LABEL);

function isValidStatus(value: string | undefined): value is ItemStatus {
  return !!value && value in STATUS_LABEL;
}

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// 後台物品管理頁（master-plan §7 第 7 項）：moderator/admin 才能看，其餘一律 404
// （比照 /admin/support-tickets 現有的權限判斷寫法）。這裡沒有現成的「後台物品搜尋」API
// 可呼叫（GET /api/items 只查 published 物品，不是給後台用的），所以直接查 db（比照
// /admin/support-tickets、/notifications 既有的 server component 直接查詢慣例）；
// 實際下架動作則呼叫既有的 PATCH /api/items/[id]/force-remove，不重寫那支 API 的邏輯。
export default async function AdminItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const { q, status, cursor } = await searchParams;
  const keyword = q?.trim() || undefined;
  const statusFilter = isValidStatus(status) ? status : undefined;

  const where = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(keyword ? { title: { contains: keyword, mode: "insensitive" as const } } : {}),
  };

  const items = await db.item.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      city: { select: { name: true } },
      category: { select: { name: true } },
      owner: { select: { id: true, profile: { select: { nickname: true } } } },
    },
  });
  const hasMore = items.length > PAGE_SIZE;
  const page = hasMore ? items.slice(0, PAGE_SIZE) : items;

  function filterHref(overrides: { cursor?: string }) {
    const qs = new URLSearchParams();
    if (keyword) qs.set("q", keyword);
    if (statusFilter) qs.set("status", statusFilter);
    if (overrides.cursor) qs.set("cursor", overrides.cursor);
    const query = qs.toString();
    return `/admin/items${query ? `?${query}` : ""}`;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">物品管理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">搜尋物品，必要時強制下架（必填原因＋備註）。</p>

      <div className="mt-6">
        <AdminNav current="/admin/items" />
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={keyword ?? ""}
          placeholder="依標題搜尋"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">全部狀態</option>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </select>
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
            沒有符合條件的物品
          </p>
        ) : (
          page.map((item) => (
            <div key={item.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/items/${item.id}`}
                    className="text-sm font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-xs text-ink-soft">
                    {item.category.name}・{item.city.name}・物主：
                    {item.owner.profile?.nickname ?? "好物共享使用者"}・
                    {TAIPEI_FORMATTER.format(item.createdAt)}
                  </p>
                </div>
                <Badge variant={item.status === "removed_by_moderator" ? "destructive" : "outline"}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </Badge>
              </div>
              {!TERMINAL_STATUSES.has(item.status) && <ForceRemoveForm itemId={item.id} />}
            </div>
          ))
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
