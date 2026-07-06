import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { createPublishedItem } from "../support/items";

// master-plan §6 驗收清單：
// 「SEO：curl 物品詳情頁（無 JS）看得到標題與描述文字；頁面含 Product JSON-LD；
// /sitemap.xml 列出 published 物品」
//
// 這裡用純 fetch（不執行 JS，等同 curl）驗證 SSR 內容；curl 的實際輸出另外附在
// 驗收報告裡（見 PR 說明），這支測試是可以重複執行、進 CI 的版本。
describe("SEO/AEO：SSR 內容與 sitemap", () => {
  const userIds: string[] = [];
  const title = `SEO測試物品-${Date.now()}`;

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("物品詳情頁 SSR 含標題、描述、Product JSON-LD", async () => {
    const owner = await createTestUser({ label: "seo-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title });

    const res = await fetch(`${BASE_URL}/items/${itemId}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain(title);
    expect(html).toContain("整合測試用的假物品描述內容");
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain('"@type":"Offer"');
    expect(html).toContain('"priceCurrency":"TWD"');
  });

  it("/sitemap.xml 列出這個 published 物品", async () => {
    const owner = await createTestUser({ label: "seo-sitemap-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title: `${title}-sitemap` });

    const res = await fetch(`${BASE_URL}/sitemap.xml`);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`/items/${itemId}`);
  });

  it("robots.txt 指向 sitemap.xml", async () => {
    const res = await fetch(`${BASE_URL}/robots.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Sitemap:");
    expect(text).toContain("/sitemap.xml");
  });
});
