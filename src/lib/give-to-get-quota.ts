import { getUserContributionScore } from "@/lib/contribution";
import { db } from "@/lib/db";

// M9（master-plan §9a 交付內容 3）：give-to-get 領取配額——券票點三類物品的每日
// 「留言/認領」次數依使用者累計貢獻值分級，新手額度較低、分享過券後額度提高，
// 藉此鼓勵「先分享才能多拿」的正向循環；一般實體物品完全不受這支邏輯影響。
//
// 級距數字為草案（⚠️ 假定待確認，見 master-plan §9a 原文「具體級距數字為草案，待使用者
// 確認」）：先給一組保守但可驗收的預設值，之後有真實使用數據再調整，呼叫端不必改。
export const GIVE_TO_GET_QUOTA_TIERS: readonly { minScore: number; dailyLimit: number }[] = [
  { minScore: 0, dailyLimit: 1 },
  { minScore: 10, dailyLimit: 3 },
  { minScore: 50, dailyLimit: 10 },
];

// 券票點三類的分類 slug（見 src/lib/categories.ts、prisma/seed.ts 的 M9 分類種子）。
export const GIVE_TO_GET_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  "coupons",
  "tickets",
  "points",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** 依累計貢獻值分數找出對應級距的每日額度（分數落在多個級距之間取門檻最高的那個）。 */
export function resolveDailyLimit(score: number): number {
  let limit = GIVE_TO_GET_QUOTA_TIERS[0].dailyLimit;
  for (const tier of GIVE_TO_GET_QUOTA_TIERS) {
    if (score >= tier.minScore) limit = tier.dailyLimit;
  }
  return limit;
}

export class GiveToGetQuotaExceededError extends Error {}

/**
 * 檢查使用者「近 24 小時」對券票點類物品的留言/認領次數是否已達當日配額，達到就丟
 * `GiveToGetQuotaExceededError`（呼叫端 catch 起來回 429）。刻意採跟 src/lib/rate-limit.ts
 * 一致的「滾動視窗」風格而非「今天 00:00 起算」，理由相同：不新增排程或時區邊界判斷，
 * 直接用 createdAt 時間窗 COUNT(*)。呼叫端只在確認物品屬於券票點三類時才呼叫這支函式，
 * 這裡不重複判斷分類。
 */
export async function checkGiveToGetQuota(userId: string): Promise<void> {
  const score = await getUserContributionScore(userId);
  const limit = resolveDailyLimit(score);

  const since = new Date(Date.now() - DAY_MS);
  const count = await db.claimComment.count({
    where: {
      userId,
      createdAt: { gte: since },
      item: { category: { slug: { in: Array.from(GIVE_TO_GET_CATEGORY_SLUGS) } } },
    },
  });

  if (count >= limit) {
    throw new GiveToGetQuotaExceededError(
      `券／票／點類物品每日最多可認領 ${limit} 次，累積分享貢獻值可以提高額度，請明天再試`,
    );
  }
}
