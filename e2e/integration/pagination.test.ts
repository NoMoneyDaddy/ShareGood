import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ITEM_COUNT, seedPaginationData } from "../fixtures/seed-pagination-data";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// master-plan §6 驗收清單：
// 「列表在 500 筆假資料下分頁正常運作、查詢用到索引（EXPLAIN 確認無 seq scan on items 主查詢）」
//
// GET /api/items 是這次補上的列表端點（見 src/app/api/items/route.ts），查詢欄位對齊
// master-plan §11.2 的複合索引 items(status, city_id, category_id, created_at)。
describe("物品列表分頁與索引", () => {
  const userIds: string[] = [];
  let cityId = "";
  let categoryId = "";
  let expectedCountInBucket = 0;

  beforeAll(async () => {
    const owner = await createTestUser({ label: "pagination-owner" });
    userIds.push(owner.id);
    const { cities, categories } = await seedPaginationData(owner.id, DEFAULT_ITEM_COUNT);
    // 固定挑第一個縣市＋第一個分類的組合，跟 seed 腳本 `i % length` 的分配方式對應，
    // 用來驗證「篩選＋分頁」跟後面的 EXPLAIN 查同一個查詢形狀。
    cityId = cities[0].id;
    categoryId = categories[0].id;
    expectedCountInBucket = await db.item.count({
      where: { ownerId: owner.id, status: "published", cityId, categoryId },
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupTestData(userIds);
  }, 120_000);

  it("預設分頁：每頁筆數符合上限、cursor 可以往下一頁翻且不重複", async () => {
    const page1 = await api("/api/items?limit=20");
    expect(page1.status).toBe(200);
    const body1 = page1.json as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body1.items).toHaveLength(20);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await api(`/api/items?limit=20&cursor=${body1.nextCursor}`);
    expect(page2.status).toBe(200);
    const body2 = page2.json as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(body2.items).toHaveLength(20);

    const idsPage1 = new Set(body1.items.map((i) => i.id));
    for (const item of body2.items) {
      expect(idsPage1.has(item.id)).toBe(false); // 兩頁不重複
    }
  });

  it("分頁上限：limit 超過 50 會被夾到 50", async () => {
    const res = await api("/api/items?limit=999");
    expect(res.status).toBe(200);
    const body = res.json as { items: unknown[] };
    expect(body.items.length).toBeLessThanOrEqual(50);
  });

  it("縣市＋分類篩選：翻完所有頁，總筆數等於資料庫實際筆數", async () => {
    let cursor: string | null = null;
    let total = 0;
    let guard = 0;
    do {
      const res: { status: number; json: unknown } = await api(
        `/api/items?cityId=${cityId}&categoryId=${categoryId}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.status).toBe(200);
      const body = res.json as { items: Array<{ city: string }>; nextCursor: string | null };
      total += body.items.length;
      cursor = body.nextCursor;
      guard++;
    } while (cursor && guard < 200);

    expect(total).toBe(expectedCountInBucket);
  }, 60_000);

  it("EXPLAIN ANALYZE：縣市＋分類＋狀態＋排序這個主查詢沒有 Seq Scan on items", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE
       SELECT id, title, status, city_id, category_id, created_at
       FROM items
       WHERE status = 'published' AND city_id = $1 AND category_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 21`,
      cityId,
      categoryId,
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    console.log("\n--- EXPLAIN ANALYZE: /api/items 主查詢（狀態+縣市+分類+排序） ---");
    console.log(plan);

    expect(plan).not.toMatch(/Seq Scan on items/);
    expect(plan).toMatch(/Index/); // 確認確實用了某種索引掃描（Index Scan / Index Only Scan）
  });
});
