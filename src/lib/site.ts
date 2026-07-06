// 對外可存取的站台 origin，沿用 root layout（src/app/layout.tsx）已經在用的 AUTH_URL
// 慣例（Auth.js v5 站台網址設定）；本機/未設定時 fallback 到正式站網域。統一在這裡去除
// 結尾斜線，避免 sitemap.ts/robots.ts 各自拼接時因為環境變數帶斜線而產生雙斜線網址。
export function siteBaseUrl(): string {
  const raw = process.env.AUTH_URL ?? "https://sharegood.nomoneydaddy.app";
  return raw.replace(/\/$/, "");
}
