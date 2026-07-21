import { db } from "@/lib/db";

// M12 交付內容 1（雙向互評，master-plan §10a／docs/plan/m12-product-growth.md）：
// 個人頁與物品詳情頁的信任訊號聚合查詢，比照 getUserSharingStats 的 groupBy/aggregate 風格。
export type UserRatingStats = {
  avgStars: number | null; // 無評分時 null（前端顯示「尚無評分」而非 0 星誤導）
  ratingCount: number;
};

export async function getUserRatingStats(userId: string): Promise<UserRatingStats> {
  const agg = await db.handoverRating.aggregate({
    where: { rateeId: userId },
    _avg: { stars: true },
    _count: { _all: true },
  });
  return {
    avgStars: agg._avg.stars,
    ratingCount: agg._count._all,
  };
}
