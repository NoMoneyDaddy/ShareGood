import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

// 首頁公開活躍度儀表板（訪客可見，見 CLAUDE.md「首頁統計區塊」需求）。
//
// 台北時區邊界計算沿用 src/lib/notifications.ts 的 startOfTaipeiDay 手法（同一套
// UTC+8 固定位移公式，台灣不實施日光節約時間），這裡另外加一個「本週」（週一 00:00）
// 版本；沒有直接 import 那支既有 helper 是因為它沒有 export，重新複製同一段短公式比
// 額外 export 一個只給這裡用的函式更省事。
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function startOfTaipeiDay(date: Date): Date {
  const taipeiMs = date.getTime() + TAIPEI_OFFSET_MS;
  const taipeiDate = new Date(taipeiMs);
  const taipeiMidnightUtcMs = Date.UTC(
    taipeiDate.getUTCFullYear(),
    taipeiDate.getUTCMonth(),
    taipeiDate.getUTCDate(),
  );
  return new Date(taipeiMidnightUtcMs - TAIPEI_OFFSET_MS);
}

/** 台北時區本週週一 00:00 對應的 UTC 時間點（ISO 週，週一為週間第一天）。 */
function startOfTaipeiWeek(date: Date): Date {
  const taipeiMs = date.getTime() + TAIPEI_OFFSET_MS;
  const taipeiDate = new Date(taipeiMs);
  const dayOfWeek = taipeiDate.getUTCDay(); // 0=週日...6=週六
  const daysSinceMonday = (dayOfWeek + 6) % 7; // 週一=0
  const mondayUtcMs = Date.UTC(
    taipeiDate.getUTCFullYear(),
    taipeiDate.getUTCMonth(),
    taipeiDate.getUTCDate() - daysSinceMonday,
  );
  return new Date(mondayUtcMs - TAIPEI_OFFSET_MS);
}

export type HomeStatCard = {
  key: string;
  label: string;
  sublabel: string;
  value: number;
};

/**
 * 平台目前進行中的物品狀態（見 prisma/schema.prisma ItemStatus）：published（已上架，
 * 待留言/直贈/抽籤）、reserved（已配對，待交接）、handover_pending（交接進行中）。
 * 三者合計代表「還沒走到 completed/expired/removed 終態」的好物，對訪客而言就是
 * 「現在平台上還在流通的好物」。
 */
const ACTIVE_ITEM_STATUSES = ["published", "reserved", "handover_pending"] as const;

async function computeHomeStats(): Promise<HomeStatCard[]> {
  const now = new Date();
  const todayStart = startOfTaipeiDay(now);
  const weekStart = startOfTaipeiWeek(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    todayPublished,
    sevenDayPublished,
    totalPublishedEver,
    completedCount,
    weeklyNewProfiles,
    totalProfiles,
    activeItems,
  ] = await Promise.all([
    db.item.count({ where: { publishedAt: { gte: todayStart } } }),
    db.item.count({ where: { publishedAt: { gte: sevenDaysAgo } } }),
    db.item.count({ where: { publishedAt: { not: null } } }),
    db.item.count({ where: { status: "completed" } }),
    db.profile.count({ where: { createdAt: { gte: weekStart } } }),
    db.profile.count({}),
    db.item.count({ where: { status: { in: [...ACTIVE_ITEM_STATUSES] } } }),
  ]);

  const cards: Array<HomeStatCard | null> = [
    // 卡 1：今日新上架。平台剛起步時「今日新上架 0」很難看，逐級放寬時間窗口找一個
    // 大於 0 的真實數字顯示，並把標籤同步改成對應的時間範圍（不謊報統計口徑）；
    // 三個口徑都是 0 才代表平台真的還沒有任何上架紀錄，這種情況下不顯示這張卡。
    todayPublished > 0
      ? {
          key: "new-listings",
          label: "今日新上架",
          sublabel: "今天有人分享出新的好物",
          value: todayPublished,
        }
      : sevenDayPublished > 0
        ? {
            key: "new-listings",
            label: "近 7 天新上架",
            sublabel: "最近一週上架的好物",
            value: sevenDayPublished,
          }
        : totalPublishedEver > 0
          ? {
              key: "new-listings",
              label: "累計上架好物",
              sublabel: "平台開站至今上架的好物",
              value: totalPublishedEver,
            }
          : null,
    // 卡 2：累計完成分享，本身就是全站累計口徑，沒有更小的時間窗口可以逐級放寬，
    // 是 0 就代表真的還沒有任何一筆完成的分享，直接隱藏這張卡。
    completedCount > 0
      ? {
          key: "completed-shares",
          label: "累計完成分享",
          sublabel: "順利完成交接的好物",
          value: completedCount,
        }
      : null,
    // 卡 3：本週新夥伴。同卡 1 邏輯，本週是 0 就放寬成累計已加入的人數。
    weeklyNewProfiles > 0
      ? {
          key: "new-partners",
          label: "本週新夥伴",
          sublabel: "本週加入的分享夥伴",
          value: weeklyNewProfiles,
        }
      : totalProfiles > 0
        ? {
            key: "new-partners",
            label: "累計好夥伴",
            sublabel: "已加入 ShareGood 的分享夥伴",
            value: totalProfiles,
          }
        : null,
    // 卡 4：進行中的好物，本身是「當下狀態」的即時快照，沒有時間窗口可以放寬，
    // 是 0 就直接隱藏。
    activeItems > 0
      ? {
          key: "active-items",
          label: "進行中的好物",
          sublabel: "目前還在尋找新主人的好物",
          value: activeItems,
        }
      : null,
  ];

  return cards.filter((card): card is HomeStatCard => card !== null);
}

// 首頁本身因為 auth()（內部呼叫 cookies()）已經是 per-request 動態渲染（見 Next.js
// glossary「Dynamic APIs」：cookies()/headers()/searchParams/draftMode 都會讓所在的
// component 樹選擇動態渲染），route segment 層級的 `export const revalidate` 在這種
// 情境下不會生效——不管設多少秒，每個請求還是會整頁重新渲染。要讓「訪客不用每次都真的
// 打 5 支 count 查詢」這個目標成立，只能把快取縮小到這幾支查詢本身，所以用
// `unstable_cache`（見 node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
// unstable_cache.md 與 02-guides/incremental-static-regeneration.md 「如果用 ORM 或連線
// 資料庫，用 unstable_cache」的建議），5 分鐘（300 秒）重新整理一次，符合規格要求的
// 「5 分鐘快取，避免每個訪客都打 count 查詢」。
export const getHomeStats = unstable_cache(computeHomeStats, ["home-stats"], {
  revalidate: 300,
});
