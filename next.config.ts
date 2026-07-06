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
              // publicUrl() 只會組出 `${S3_PUBLIC_URL}/images/...`（見 src/lib/storage.ts），
              // 限制 pathname 避免 next/image 被拿去優化這個 host 上其他不相干的路徑。
              pathname: "/images/**",
            },
            {
              protocol: s3PublicUrl.protocol.replace(":", "") as "http" | "https",
              hostname: s3PublicUrl.hostname,
              port: s3PublicUrl.port || undefined,
              // M2 使用者回報附件（見 src/app/api/uploads/support-attachment/route.ts）走獨立
              // 的 support-attachments/ 前綴，不跟物品圖片共用 images/ 前綴，這裡另開一條白名單。
              pathname: "/support-attachments/**",
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
