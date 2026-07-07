// M3 優惠券／即期食品規則靠既有分類 slug 判斷（master-plan.md §8）；分類本身的資料在
// prisma/seed.ts 定義（"優惠票券"／slug "coupons"、"食品雜貨"／slug "groceries"）。這裡集中
// 管理判斷用的 slug 常數，避免字串魔法值散落在 API route 與表單元件裡。
export const COUPON_CATEGORY_SLUG = "coupons";
export const EXPIRING_FOOD_CATEGORY_SLUG = "groceries";
// M9（master-plan.md §9a 共通設計決策）：票券／點數比照優惠券沿用 category slug 模式判別
// 內容類型，不加 items.type 欄位；分類種子（"電子票券"／slug "tickets"、"點數好康"／slug
// "points"）已在 prisma/seed.ts 定義。
export const TICKET_CATEGORY_SLUG = "tickets";
export const POINT_CATEGORY_SLUG = "points";
