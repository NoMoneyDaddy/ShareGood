import { MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { listPublishedItems } from "@/lib/items";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export const metadata = { title: "逛好物" };

const PAGE_SIZE = 20;

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
});

// /items 瀏覽頁（master-plan §6 第 2 項「列表」；CLAUDE.md 記錄的已知遺留缺口——首頁一直是
// DEMO_ITEMS 示範資料，GET /api/items 列表端點做好之後始終沒有真正的瀏覽頁在用它）。
// server component 直接呼叫 src/lib/items.ts 的 listPublishedItems（跟 GET /api/items
// 共用同一段查詢邏輯），不自打 HTTP；分頁比照 /notifications 的「下一頁」整頁換頁慣例，
// 篩選比照 /admin/items 既有的 GET method 原生表單慣例。
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cityId?: string;
    categoryId?: string;
    q?: string;
    sort?: string;
    cursor?: string;
  }>;
}) {
  const { cityId, categoryId, q, sort, cursor } = await searchParams;
  const keyword = q?.trim() || undefined;
  const activeSort = sort === "expiring" ? "expiring" : "newest";

  // session/profile 給 SiteHeader 用的查詢已收斂進 (shell)/layout.tsx，這裡不用再查一次。
  const [cities, categories, result] = await Promise.all([
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    listPublishedItems({
      cityId,
      categoryId,
      keyword,
      cursor,
      limit: PAGE_SIZE,
      sort: activeSort,
    }),
  ]);

  // 篩選條件＋分頁游標一起組回查詢字串：切換排序／換頁時要保留目前的縣市/分類/關鍵字篩選。
  function hrefWith(overrides: { sort?: string; cursor?: string | null }) {
    const qs = new URLSearchParams();
    if (cityId) qs.set("cityId", cityId);
    if (categoryId) qs.set("categoryId", categoryId);
    if (keyword) qs.set("q", keyword);
    const nextSort = overrides.sort ?? activeSort;
    if (nextSort !== "newest") qs.set("sort", nextSort);
    if (overrides.cursor) qs.set("cursor", overrides.cursor);
    const query = qs.toString();
    return `/items${query ? `?${query}` : ""}`;
  }

  const hasFilters = !!(cityId || categoryId || keyword);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">逛好物</h1>
      <p className="mt-1.5 text-sm text-ink-soft">看看鄰居分享了什麼，留言就有機會接手。</p>

      <form method="get" action="/items" className="mt-6 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={keyword ?? ""}
          placeholder="搜尋好物、分類或縣市…"
          aria-label="搜尋好物、分類或縣市"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        <select
          name="cityId"
          defaultValue={cityId ?? ""}
          aria-label="依縣市篩選"
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">全部縣市</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
        <select
          name="categoryId"
          defaultValue={categoryId ?? ""}
          aria-label="依分類篩選"
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">全部分類</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {/* 排序用隱藏欄位帶著送出，避免搜尋／篩選送出後把目前的排序條件重置成預設值 */}
        <input type="hidden" name="sort" value={activeSort} />
        <button
          type="submit"
          className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
        >
          搜尋
        </button>
      </form>

      <div className="mt-3 flex gap-2 text-sm">
        <Link
          href={hrefWith({ sort: "newest", cursor: null })}
          aria-current={activeSort === "newest" ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1.5 transition-colors",
            activeSort === "newest"
              ? "border-brand bg-brand/10 font-medium text-brand-ink"
              : "border-line text-ink-soft hover:bg-paper-2",
          )}
        >
          最新上架
        </Link>
        <Link
          href={hrefWith({ sort: "expiring", cursor: null })}
          aria-current={activeSort === "expiring" ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1.5 transition-colors",
            activeSort === "expiring"
              ? "border-brand bg-brand/10 font-medium text-brand-ink"
              : "border-line text-ink-soft hover:bg-paper-2",
          )}
        >
          即將到期
        </Link>
      </div>

      {result.items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-line bg-card px-4 py-10 text-center">
          <p className="text-sm text-ink-soft">
            {hasFilters
              ? "找不到符合條件的物品，試試調整篩選條件或關鍵字。"
              : "目前還沒有物品上架，稍後再回來看看。"}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            有用不到的好物嗎？
            <Link href="/items/new" className="text-brand-ink underline-offset-2 hover:underline">
              馬上分享出去
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
          {result.items.map((item) => (
            <Link
              key={item.id}
              href={`/items/${item.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-paper-2">
                {item.thumbObjectKey ? (
                  <Image
                    src={publicUrl(item.thumbObjectKey)}
                    alt={item.title}
                    fill
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-ink-soft">
                    無圖片
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-xs font-bold text-white">
                  免費
                </span>
                {item.expiresAt && (
                  <span className="absolute right-2 top-2 rounded-md bg-destructive px-2 py-0.5 text-xs font-bold text-white">
                    {TAIPEI_DATE_FORMATTER.format(item.expiresAt)} 到期
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-1 text-[11px] text-ink-soft">
                  <MapPin size={11} strokeWidth={2.4} aria-hidden="true" />
                  {item.city}
                </div>
                <h3 className="mt-1 truncate font-semibold leading-snug">{item.title}</h3>
                <span className="mt-2 inline-block rounded-md bg-paper-2 px-2 py-0.5 text-[11px] text-ink-soft">
                  {item.category}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {result.nextCursor && (
        <div className="mt-8 flex justify-center">
          <Link
            href={hrefWith({ cursor: result.nextCursor })}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            下一頁 →
          </Link>
        </div>
      )}
    </div>
  );
}
