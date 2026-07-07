import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
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
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
