import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ShareGood 好物共享",
    short_name: "ShareGood",
    description:
      "把用不到但還能用的好物免費分享出去，讓剛好需要的人接手。台灣縣市級免費共享平台，不買賣、不交換。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "zh-TW",
    theme_color: "#363636",
    background_color: "#ffffff",
    icons: [
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
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        form_factor: "narrow",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        form_factor: "wide",
      },
    ],
  };
}
