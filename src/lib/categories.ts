// M3 優惠券／即期食品規則靠既有分類 slug 判斷（master-plan.md §8）；分類本身的資料在
// prisma/seed.ts 定義（"優惠票券"／slug "coupons"、"食品雜貨"／slug "groceries"）。這裡集中
// 管理判斷用的 slug 常數，避免字串魔法值散落在 API route 與表單元件裡。
export const COUPON_CATEGORY_SLUG = "coupons";
export const EXPIRING_FOOD_CATEGORY_SLUG = "groceries";
