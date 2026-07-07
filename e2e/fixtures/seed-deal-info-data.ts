import { db } from "../support/db";

/**
 * 好康列表分頁／索引驗收用的假資料（master-plan §9a 驗收清單：「deal_infos 列表查詢
 * （狀態＋縣市/全台篩選＋cursor 分頁）以 500+ 筆假資料跑 EXPLAIN ANALYZE，走 §11.2
 * 新建索引（Index Scan，非 Seq Scan）」）。比照 e2e/fixtures/seed-pagination-data.ts
 * 既有慣例：表太小時規劃器會選 Seq Scan（全表掃描本來就比較便宜，不是索引沒生效），
 * 把量放大到 DEFAULT_DEAL_INFO_COUNT 讓 EXPLAIN ANALYZE 能真的觀察到索引被使用到。
 */
export const DEFAULT_DEAL_INFO_COUNT = 20_000;

export async function seedDealInfoData(count = DEFAULT_DEAL_INFO_COUNT) {
  const baseTime = Date.now();
  const batchSize = 1000;
  for (let start = 0; start < count; start += batchSize) {
    const batch = [];
    const end = Math.min(start + batchSize, count);
    for (let i = start; i < end; i++) {
      const createdAt = new Date(baseTime - i * 1000);
      batch.push({
        title: `壓測好康 #${i}`,
        summary: "分頁與索引驗收用的假資料，測試結束會被清除",
        sourceUrl: "https://example.com/deal",
        sourceType: "editorial" as const,
        isNationwide: true,
        status: "published" as const,
        verifiedAt: createdAt,
        expiresAt: new Date(baseTime + 30 * 24 * 60 * 60 * 1000),
        publishedAt: createdAt,
        createdAt,
      });
    }
    await db.dealInfo.createMany({ data: batch });
  }

  // bulk insert 完一定要 ANALYZE，不然規劃器手上的統計資訊還是空表時代的舊資料，
  // 即使有索引也可能因為誤判選擇性而選 Seq Scan（見 seed-pagination-data.ts 同一個教訓）。
  await db.$executeRawUnsafe("ANALYZE deal_infos;");
}
