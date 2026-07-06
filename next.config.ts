import type { NextConfig } from "next";

// 物品圖片走 MinIO 的 S3_PUBLIC_URL；環境變數缺漏就讓 next/image 在請求時明確報錯，
// 不在設定檔這裡加防呆掩蓋部署設定漏掉的問題。
const s3PublicUrl = process.env.S3_PUBLIC_URL ? new URL(process.env.S3_PUBLIC_URL) : null;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // 首頁熱門好物目前仍是示範圖片，留言/接受/直贈等功能上線後移除
      { protocol: "https", hostname: "picsum.photos" },
      ...(s3PublicUrl
        ? [
            {
              protocol: s3PublicUrl.protocol.replace(":", "") as "http" | "https",
              hostname: s3PublicUrl.hostname,
              port: s3PublicUrl.port || undefined,
              // publicUrl() 組出 `${S3_PUBLIC_URL}/images/...`（見 src/lib/storage.ts）；
              // S3_PUBLIC_URL 本身可能已經帶路徑（本機 MinIO path-style 慣例，例如
              // ".env.example" 的 "http://localhost:9000/sharegood" 就帶了 bucket 名稱這段
              // path），漏算這段會讓 next/image 用「/images/**」比對不到實際路徑「/sharegood/
              // images/**」而報 "hostname is not configured"。這裡把 s3PublicUrl 自己的
              // pathname 併進來，兩種情境（S3_PUBLIC_URL 純 host、或帶 bucket 路徑）都涵蓋。
              pathname: `${s3PublicUrl.pathname === "/" ? "" : s3PublicUrl.pathname}/images/**`,
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
