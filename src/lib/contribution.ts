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
