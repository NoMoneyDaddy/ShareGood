import type { MetadataRoute } from "next";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { siteBaseUrl } from "@/lib/site";

const baseUrl = siteBaseUrl();

// 注意：M1 現階段 published 物品數量遠不到 Next.js 單一 sitemap 上限（約 5 萬筆 URL），
// 先用單一 sitemap；未來若物品量逼近上限，需改用 generateSitemaps() 拆分成多個 sitemap。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [items, dealInfos] = await Promise.all([
    db.item.findMany({
      where: { status: "published" },
      select: { id: true, updatedAt: true },
    }),
    // M9（master-plan §9a 交付內容 1）：DealInfo 詳情頁也產生 SEO metadata，比照物品頁
    // 一併納入 sitemap；只收錄 published（pending_review 對非投稿者/非 moderator/admin
    // 是 404，不該被收錄；stale/expired/rejected 仍可被直接連結存取，但不主動收錄進
    // sitemap，避免導引流量到內容可能已經過期或被駁回的頁面）。
    db.dealInfo.findMany({
      where: { status: DealInfoStatus.published },
      select: { id: true, updatedAt: true },
    }),
  ]);

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
    { url: `${baseUrl}/deal-infos` },
    { url: `${baseUrl}/terms` },
    { url: `${baseUrl}/privacy` },
  ];

  const itemPages: MetadataRoute.Sitemap = items.map((item) => ({
    url: `${baseUrl}/items/${item.id}`,
    lastModified: item.updatedAt,
  }));

  const dealInfoPages: MetadataRoute.Sitemap = dealInfos.map((d) => ({
    url: `${baseUrl}/deal-infos/${d.id}`,
    lastModified: d.updatedAt,
  }));

  return [...staticPages, ...itemPages, ...dealInfoPages];
}
