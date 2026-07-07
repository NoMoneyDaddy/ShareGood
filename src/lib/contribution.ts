import { db } from "@/lib/db";

// 貢獻值分數設定（master-plan 要求數值進 config 不寫死，方便之後調整）。
export const CONTRIBUTION_POINTS = {
  share_completed: 10,
  receive_completed: 2,
  no_show: -5,
} as const;

export type ContributionEventType = keyof typeof CONTRIBUTION_POINTS;

// M9（master-plan §9a 交付內容 3）：give-to-get 領取配額需要使用者的累計貢獻值分數；
// `User` 表依規格明文不能加欄位快取這個分數，這裡直接對 contribution_events 做 SUM
// 聚合（該表已有 `@@index([userId, createdAt])`，量體在目前階段可接受，之後真的需要
// 快取再換掉這支函式的實作，呼叫端不必改）。
export async function getUserContributionScore(userId: string): Promise<number> {
  const result = await db.contributionEvent.aggregate({
    where: { userId },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
}

export type UserSharingStats = {
  /** 累計貢獻值（含 no_show 扣分，可能為負，跟 getUserContributionScore 同口徑）。 */
  totalPoints: number;
  /** 已完成分享件數＝share_completed 事件數。 */
  sharedCount: number;
  /** 已接手完成件數＝receive_completed 事件數。 */
  receivedCount: number;
};

// 正式上線衝刺（信任訊號）：公開個人頁與物品詳情頁要顯示「已完成分享 N 件／已接手 N 件」。
// 口徑刻意跟貢獻值記分完全一致——share_completed／receive_completed 事件只會在
// /api/handover/[id]/complete 的 `flipped.count === 1` 原子分支各寫入一筆（雙方確認才成立、
// 併發與重複呼叫都不會重複記），所以「事件數＝完成件數」，天然去重、也不用再對
// items/handover_records 另做一套容易跟記分口徑漂移的反查。一次 groupBy 同時拿到
// 總分與兩個件數，呼叫端不用再另跑 aggregate。
export async function getUserSharingStats(userId: string): Promise<UserSharingStats> {
  const grouped = await db.contributionEvent.groupBy({
    by: ["type"],
    where: { userId },
    _count: { _all: true },
    _sum: { points: true },
  });
  const stats: UserSharingStats = { totalPoints: 0, sharedCount: 0, receivedCount: 0 };
  for (const row of grouped) {
    stats.totalPoints += row._sum.points ?? 0;
    if (row.type === "share_completed") stats.sharedCount = row._count._all;
    if (row.type === "receive_completed") stats.receivedCount = row._count._all;
  }
  return stats;
}
