import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { siteBaseUrl } from "@/lib/site";

const baseUrl = siteBaseUrl();

// 注意：M1 現階段 published 物品數量遠不到 Next.js 單一 sitemap 上限（約 5 萬筆 URL），
// 先用單一 sitemap；未來若物品量逼近上限，需改用 generateSitemaps() 拆分成多個 sitemap。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items = await db.item.findMany({
    where: { status: "published" },
    select: { id: true, updatedAt: true },
  });

  // 首頁的 lastModified 用「最新一筆物品的更新時間」而不是 new Date()：如果每次爬蟲來
  // 都回傳當下時間，等於在告訴搜尋引擎首頁「永遠剛剛更新過」，反而浪費檢索預算
  // （crawl budget）；沒有任何物品時才 fallback 成現在。
  const latestItemUpdate = items.reduce(
    (max, item) => (item.updatedAt > max ? item.updatedAt : max),
    new Date(0),
  );
  const homeLastModified = latestItemUpdate.getTime() > 0 ? latestItemUpdate : new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: homeLastModified,
    },
    // 新手說明／使用規則／服務條款／隱私權政策：純靜態內容頁，lastModified 用部署時間即可。
    { url: `${baseUrl}/guide` },
    { url: `${baseUrl}/rules` },
    { url: `${baseUrl}/terms` },
    { url: `${baseUrl}/privacy` },
  ];

  const itemPages: MetadataRoute.Sitemap = items.map((item) => ({
    url: `${baseUrl}/items/${item.id}`,
    lastModified: item.updatedAt,
  }));

  return [...staticPages, ...itemPages];
}
