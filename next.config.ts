import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // 示範圖片（M1 起改為 MinIO 的 S3_PUBLIC_URL）
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;
