import { CheckCircle2, PackagePlus, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import { getHomeStats, type HomeStatCard } from "@/lib/home-stats";

// 每張卡固定配一個圖示，用 `key`（見 src/lib/home-stats.ts 的口徑放寬邏輯，同一張卡
// 不論顯示「今日/近 7 天/累計」哪個口徑，key 都不變）對應，不用陣列索引避免卡片數量
// 因為 0 值隱藏而變動時圖示對錯位。
const CARD_ICON: Record<HomeStatCard["key"], typeof PackagePlus> = {
  "new-listings": PackagePlus,
  "completed-shares": CheckCircle2,
  "new-partners": UserPlus,
  "active-items": Sparkles,
};

// 每張統計卡都是一個導流入口，不做「純展示的死數字」：上架/進行中導到瀏覽頁促成交，
// 完成/夥伴導到排行榜承接「想看看誰在分享」的好奇。
const CARD_HREF: Record<HomeStatCard["key"], string> = {
  "new-listings": "/items",
  "completed-shares": "/leaderboard",
  "new-partners": "/leaderboard",
  "active-items": "/items",
};

const NUMBER_FORMATTER = new Intl.NumberFormat("zh-Hant-TW");

export async function HomeStatsSection() {
  const stats = await getHomeStats();

  // 全部口徑放寬到底都還是 0（平台真的還沒有任何資料）：與其擠出一整排 0，不如整段
  // 不顯示，訪客看不到這個區塊，總比看到一排尷尬的 0 好。
  if (stats.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-2 sm:px-6" aria-label="平台即時動態">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = CARD_ICON[stat.key];
          return (
            <Link
              key={stat.key}
              href={CARD_HREF[stat.key]}
              className="block rounded-xl border border-line bg-card px-4 py-4 transition-colors hover:border-brand/40 hover:bg-paper-2/40 sm:px-5 sm:py-5"
            >
              <Icon size={18} strokeWidth={2.2} aria-hidden="true" className="text-brand-ink" />
              <p className="mt-2.5 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                {NUMBER_FORMATTER.format(stat.value)}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{stat.label}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{stat.sublabel}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
