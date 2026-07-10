import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// UX 走查（2026-07-07）順手清掉的遺留：globals.css 的 --font-sans／--font-display
// 早已改用純系統字型堆疊（見該檔「共通決策」註解），Geist（sans）與 Manrope 這兩支
// Google Fonts 從未被任何 CSS 變數引用，只是白白多打一次字型下載。--font-mono 有實際
// 引用（優惠券券碼、後台效能表格），Geist Mono 保留。
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.AUTH_URL ? new URL(process.env.AUTH_URL) : undefined,
  title: {
    default: "ShareGood 好物共享｜免費共享平台",
    template: "%s｜ShareGood 好物共享",
  },
  description:
    "把用不到但還能用的好物免費分享出去，剛好需要的人就能接手。台灣在地免費共享平台，不買賣、不交換。",
  // manifest 不在這裡手動指定：App Router 對 src/app/manifest.ts 會自動注入
  // <link rel="manifest">，重複宣告會產生兩個 link 標籤。
  openGraph: {
    siteName: "ShareGood 好物共享",
    locale: "zh_TW",
    type: "website",
  },
  // iOS Safari「加入主畫面」品質靠這幾個 meta／link 標籤，manifest.ts 不會產生：
  // apple-touch-icon 沒有專用尺寸的圖示，沿用既有 192x192（PR #49），iOS 會自動縮放，
  // 非最佳但足夠。
  appleWebApp: {
    capable: true,
    title: "ShareGood",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning：next-themes 官方要求的寫法（見其文件「with-app-dir」
    // 範例）。ThemeProvider 會在瀏覽器 hydration 前用內聯 script 讀 localStorage 並
    // 直接把 `.dark` class 掛到這個 <html> 元素上，這個時間點早於 React hydrate，
    // 兩者的 className 字串本來就會不一致，屬於預期中的差異，不是真的 bug，加這個屬性
    // 只抑制這一個元素的警告、不影響其餘 hydration mismatch 的正常偵測。
    <html
      lang="zh-TW"
      className={`${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
