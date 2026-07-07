"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// M11 主題切換（使用者實測回饋第 1 項：「沒有淺/深色切換鈕，且要預設淺色」）。
// `next-themes` 在這個專案原本就是既有相依套件（`package.json`），先前只有
// `components/ui/sonner.tsx` 呼叫 `useTheme()`，但從未真正掛上 Provider——
// 這裡把它接上，取代規格裡描述的「自製輕量 ThemeProvider」：`next-themes` 本身就是
// 那個輕量實作（不到 4KB、零其他相依），重新造一個效果相同但會失去它已經處理好的
// FOUC 防閃爍（在 hydration 前用 head 內聯 script 讀 localStorage 並同步設定
// class，而不是等 React mount 後才切換）與跨分頁同步（`storage` 事件），沒有理由
// 不用既有套件。
// - attribute="class"：對應 globals.css 的 `.dark` class strategy（M11 前是
//   `prefers-color-scheme` media query，本次收斂為只走 class）。
// - defaultTheme="light"：使用者明確要求「預設淺色」，不能预设跟随系统。
// - enableSystem={false}：同一個原因，關閉自動跟隨系統設定，只保留 light/dark
//   兩個手動選項（不提供「跟隨系統」第三態，符合本次規格單一切換鈕的設計）。
// - storageKey 用套件預設值 "theme"，符合規格「localStorage 存 theme」。
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} {...props}>
      {children}
    </NextThemesProvider>
  );
}
