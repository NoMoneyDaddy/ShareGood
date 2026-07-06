import { db } from "@/lib/db";

// M2 治理底線（master-plan.md §7）：feature flag 機制，MVP 起步只做全站開關（不做
// 百分比灰度或多環境），查 `feature_flags` 表；找不到 key 一律預設 false，
// 避免漏建 flag row 時整站行為被意外打開。

/** 目前定義的 flag key，之後新增 flag 就往這裡加一個常數，避免各處手打字串打錯。 */
export const FEATURE_FLAGS = {
  // 開啟後新上架物品狀態改成 pending_review，需要人工審核通過才會公開（後台審核佇列
  // UI 不在本次任務範圍內，留給 admin 後台那個 wave）。
  REQUIRE_REVIEW: "REQUIRE_REVIEW",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export async function getFeatureFlag(key: FeatureFlagKey): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key } });
  return flag?.enabled ?? false;
}
