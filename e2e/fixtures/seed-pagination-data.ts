import { db } from "../support/db";

/**
 * 列表分頁／索引驗收用的假資料。master-plan §6 驗收清單寫「500 筆假資料」，但本機
 * Postgres 對只有幾百筆、可以整個放進一兩個資料頁的小表，規劃器（planner）幾乎必定
 * 選擇 Seq Scan——這不是索引沒生效，是「表太小，全表掃描本來就比較便宜」，任何資料庫
 * 都一樣。為了讓 EXPLAIN ANALYZE 能觀察到索引真的被用到，這裡把量放大到
 * DEFAULT_ITEM_COUNT（預設 20000），仍然遠低於這個平台實際會有的物品量，且是可逆、
 * 隨測試結束即刪除的假資料，不影響驗收「有沒有用到索引」這個判準本身。
 */
export const DEFAULT_ITEM_COUNT = 20_000;

export async function seedPaginationData(ownerId: string, count = DEFAULT_ITEM_COUNT) {
  const [cities, categories] = await Promise.all([
    db.city.findMany({ select: { id: true } }),
    db.category.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);
  if (cities.length === 0 || categories.length === 0) {
    throw new Error("cities/categories 是空的，先跑過 prisma db seed 再測");
  }

  const baseTime = Date.now();
  const batchSize = 1000;
  for (let start = 0; start < count; start += batchSize) {
    const batch = [];
    const end = Math.min(start + batchSize, count);
    for (let i = start; i < end; i++) {
      batch.push({
        ownerId,
        title: `壓測物品 #${i}`,
        description: "分頁與索引驗收用的假資料，測試結束會被清除",
        categoryId: categories[i % categories.length].id,
        cityId: cities[i % cities.length].id,
        status: "published" as const,
        publishedAt: new Date(baseTime - i * 1000),
        createdAt: new Date(baseTime - i * 1000),
      });
    }
    await db.item.createMany({ data: batch });
  }

  // bulk insert 完一定要 ANALYZE，不然規劃器手上的統計資訊還是空表時代的舊資料，
  // 即使有索引也可能因為誤判選擇性而選 Seq Scan。
  await db.$executeRawUnsafe("ANALYZE items;");

  return { cities, categories };
}
