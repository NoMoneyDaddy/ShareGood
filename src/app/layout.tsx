import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

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
    "把用不到但還能用的好物免費分享出去，讓剛好需要的人接手。台灣縣市級免費共享平台，不買賣、不交換。",
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
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
