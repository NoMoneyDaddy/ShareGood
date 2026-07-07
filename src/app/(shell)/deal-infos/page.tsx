import { Gift } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { listPublishedDealInfos } from "@/lib/deal-info";
import { cn } from "@/lib/utils";

export const metadata = { title: "好康資訊" };

const PAGE_SIZE = 20;

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
});

// /deal-infos 瀏覽頁（master-plan §9a 交付內容 1）。刻意獨立於 /items 瀏覽頁之外——
// DealInfo 是與 Item 平行的獨立表，不共用 items(status, city_id, ...) 那條索引/查詢，
// 且 /items 瀏覽頁的篩選/排序基礎設施目前由缺口修正 wave 平行維護中，這裡不去動它，
// 降低跟其他同時在進行的 M9 功能 PR（票券/點數，皆掛在 /items 頁）衝突的機會。
export default async function DealInfosPage({
  searchParams,
}: {
  searchParams: Promise<{ cityId?: string | string[]; cursor?: string | string[] }>;
}) {
  const raw = await searchParams;
  // URL 帶重複參數時（?cityId=a&cityId=b）Next.js 會給 string[]，一律取第一個。
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const cityId = one(raw.cityId);
  const cursor = one(raw.cursor);

  // session/profile 給 SiteHeader 用的查詢已收斂進 (shell)/layout.tsx，這裡不用再查一次。
  const [cities, result] = await Promise.all([
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    listPublishedDealInfos({ cityId, cursor, limit: PAGE_SIZE }),
  ]);

  function hrefWith(overrides: { cursor?: string | null }) {
    const qs = new URLSearchParams();
    if (cityId) qs.set("cityId", cityId);
    if (overrides.cursor) qs.set("cursor", overrides.cursor);
    const query = qs.toString();
    return `/deal-infos${query ? `?${query}` : ""}`;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-ink">好康資訊</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            官方收錄與網友投稿的優惠活動資訊，非平台交付內容。
          </p>
        </div>
        {/* text-brand-foreground（非 text-white）：暗色模式下 brand 是偏亮的青色，見 globals.css 對應註解 */}
        <Link
          href="/deal-infos/new"
          className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand/90"
        >
          投稿好康
        </Link>
      </div>

      <form method="get" action="/deal-infos" className="mt-6 flex flex-wrap gap-2">
        <select
          name="cityId"
          defaultValue={cityId ?? ""}
          aria-label="依縣市篩選"
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">全部縣市（含全台適用）</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
        >
          篩選
        </button>
      </form>

      {result.dealInfos.length === 0 ? (
        // M10 批次 2：空狀態留白比例修正——原本 py-10 的小卡片在桌面版下方留下大片
        // 空白（研究文件 02 現況盤點已點名），改成更飽滿的空狀態：加圖示＋加大內距、
        // 補上投稿 CTA（比照 /items 空狀態「馬上分享出去」的既有慣例），讓空狀態本身
        // 有明確的下一步行動，而不是只有一句說明文字。
        <div className="mt-10 rounded-xl border border-line bg-card px-6 py-16 text-center">
          <Gift
            size={32}
            strokeWidth={1.5}
            className="mx-auto text-ink-disabled"
            aria-hidden="true"
          />
          <p className="mt-4 text-sm text-ink-soft">目前沒有符合條件的好康資訊。</p>
          <p className="mt-2 text-sm text-ink-soft">
            知道其他優惠活動嗎？
            <Link
              href="/deal-infos/new"
              className="text-brand-ink underline-offset-2 hover:underline"
            >
              投稿分享給大家
            </Link>
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {result.dealInfos.map((d) => (
            <li key={d.id}>
              <Link
                href={`/deal-infos/${d.id}`}
                className={cn(
                  "block rounded-xl border border-line bg-card p-4 transition-shadow hover:shadow-md",
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-soft">
                  <span>{d.isNationwide ? "全台適用" : d.cities.join("、")}</span>
                  <span>{TAIPEI_DATE_FORMATTER.format(d.expiresAt)} 到期</span>
                </div>
                <h3 className="mt-1 font-semibold leading-snug">{d.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{d.summary}</p>
                {d.dealSourceName && (
                  <span className="mt-2 inline-block rounded-md bg-paper-2 px-2 py-0.5 text-[11px] text-ink-soft">
                    來源：{d.dealSourceName}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
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
