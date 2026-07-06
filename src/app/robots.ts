import type { MetadataRoute } from "next";

const baseUrl = process.env.AUTH_URL ?? "https://sharegood.nomoneydaddy.app";

// SEO/AEO（master-plan §3.7）：私有路徑禁爬；sitemap 於 M1 隨物品頁一併提供（src/app/sitemap.ts）
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/me/", "/admin/", "/messages", "/onboarding"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
