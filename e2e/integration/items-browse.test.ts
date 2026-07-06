import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

// 任務：把 GET /api/items 這支列表端點接上真正的前端瀏覽頁（CLAUDE.md 記錄的已知遺留
// 缺口——首頁一直是 DEMO_ITEMS 示範資料，這支 API 做好之後始終沒有頁面在用它）。
// 這裡驗證：
//   1. /items 頁 SSR 內容含種入的測試物品標題（無 JS 也看得到，等同 curl）。
//   2. /items 頁的縣市/分類篩選參數確實生效（篩不到的物品不會出現在結果裡）。
//   3. 首頁不再出現先前示範資料的字樣，且顯示的是真實物品標題。
describe("物品瀏覽頁 /items 與首頁真實資料", () => {
  const userIds: string[] = [];
  const uniqueTitle = `瀏覽頁測試物品-${Date.now()}`;

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("/items 頁 SSR 含種入的測試物品標題", async () => {
    const owner = await createTestUser({ label: "items-browse-owner" });
    userIds.push(owner.id);
    await createPublishedItem(owner, { title: uniqueTitle });

    const res = await fetch(`${BASE_URL}/items`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(uniqueTitle);
    // 篩選表單本身（縣市/分類 select、關鍵字輸入框）也要存在，確認不是走到某個壞掉的分支。
    expect(html).toContain('name="q"');
    expect(html).toContain('name="cityId"');
    expect(html).toContain('name="categoryId"');
  });

  it("/items 頁縣市篩選：換一個不相關的縣市查不到剛建立的物品", async () => {
    const owner = await createTestUser({ label: "items-browse-filter-owner" });
    userIds.push(owner.id);
    const { cityId } = await pickCityAndCategory();
    const filterTitle = `篩選測試物品-${Date.now()}`;
    await createPublishedItem(owner, { title: filterTitle, cityId });

    const matchRes = await fetch(`${BASE_URL}/items?cityId=${cityId}`);
    expect(matchRes.status).toBe(200);
    const matchHtml = await matchRes.text();
    expect(matchHtml).toContain(filterTitle);

    // 資料庫裡挑一個跟上面不同的縣市，篩選結果不應該出現剛建立的物品。
    const { db } = await import("../support/db");
    const otherCity = await db.city.findFirstOrThrow({ where: { id: { not: cityId } } });
    const otherRes = await fetch(`${BASE_URL}/items?cityId=${otherCity.id}`);
    expect(otherRes.status).toBe(200);
    const otherHtml = await otherRes.text();
    expect(otherHtml).not.toContain(filterTitle);
  });

  it("/items 頁分類篩選：換一個不相關的分類查不到剛建立的物品", async () => {
    const owner = await createTestUser({ label: "items-browse-category-owner" });
    userIds.push(owner.id);
    const { categoryId } = await pickCityAndCategory();
    const filterTitle = `分類篩選測試物品-${Date.now()}`;
    await createPublishedItem(owner, { title: filterTitle, categoryId });

    const { db } = await import("../support/db");
    const otherCategory = await db.category.findFirstOrThrow({
      where: { id: { not: categoryId }, isActive: true },
    });
    const otherRes = await fetch(`${BASE_URL}/items?categoryId=${otherCategory.id}`);
    expect(otherRes.status).toBe(200);
    const otherHtml = await otherRes.text();
    expect(otherHtml).not.toContain(filterTitle);
  });

  it("首頁不再出現示範資料字樣，且顯示真實物品標題", async () => {
    const owner = await createTestUser({ label: "home-real-data-owner" });
    userIds.push(owner.id);
    const homeTitle = `首頁真實資料測試物品-${Date.now()}`;
    await createPublishedItem(owner, { title: homeTitle });

    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("示範資料");
    expect(html).not.toContain("picsum.photos");
    expect(html).toContain(homeTitle);
    // 搜尋框已啟用（不再是 disabled），送出會導向 /items。
    expect(html).toContain('action="/items"');
  });
});
