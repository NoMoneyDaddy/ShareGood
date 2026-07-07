import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ShareGood 好物共享",
    short_name: "ShareGood",
    description:
      "把用不到但還能用的好物免費分享出去，剛好需要的人就能接手。台灣在地免費共享平台，不買賣、不交換。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "zh-TW",
    // M10 提案 B「靛青與暖沙」：品牌主色 #1E6B76，背景色沿用 --color-paper 亮色值
    // （docs/research/2026-07-07-frontend-refactor/03-style-proposals.md 提案 B）。
    theme_color: "#1e6b76",
    background_color: "#f9f6ef",
    // 同一檔案同時宣告 any 與 maskable：只給 maskable 在不支援遮罩的平台（桌面
    // Chrome/Firefox 等）可能無法顯示、甚至讓 PWA 安裝檢查失敗。
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // 刻意不放 screenshots：該欄位語意是「應用程式 UI 預覽截圖」，拿圖示充數是誤用；
    // 等前端重構完成、有值得展示的畫面後再補真正的截圖。
  };
}
