import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

// SEO/AEO（master-plan §3.7）：動態 sitemap，收錄所有 published 物品＋靜態頁。
// baseUrl 沿用 root layout（src/app/layout.tsx）已經在用的 AUTH_URL 慣例（Auth.js v5
// 站台網址設定，等同對外可存取的 origin），本機/未設定時 fallback 到正式站網域。
const baseUrl = process.env.AUTH_URL ?? "https://sharegood.nomoneydaddy.app";

// 注意：M1 現階段 published 物品數量遠不到 Next.js 單一 sitemap 上限（約 5 萬筆 URL），
// 先用單一 sitemap；未來若物品量逼近上限，需改用 generateSitemaps() 拆分成多個 sitemap。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items = await db.item.findMany({
    where: { status: "published" },
    select: { id: true, updatedAt: true },
  });

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
    },
  ];

  const itemPages: MetadataRoute.Sitemap = items.map((item) => ({
    url: `${baseUrl}/items/${item.id}`,
    lastModified: item.updatedAt,
  }));

  return [...staticPages, ...itemPages];
}
