"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// 日/夜切換鈕（M11）：44px 觸控目標（size-11，比照其餘表單按鈕的 WCAG 2.5.5 標準）、
// aria-label 隨目前主題描述「即將切換到什麼」而非目前狀態，符合一般切換鈕慣例
// （螢幕閱讀器使用者聽到的是「動作」而非「現狀」）。
//
// mounted 判斷：`useTheme()` 的 `resolvedTheme` 在伺服器端渲染與第一次 client
// hydration 時一定是 undefined（要等 ThemeProvider 的內聯 script 在瀏覽器讀完
// localStorage 才知道），這裡在還沒 mounted 前先渲染一個尺寸相同、圖示中性
// （固定顯示 Sun，不會有錯誤答案，因為預設本來就是淺色）的骨架，避免 hydration
// mismatch 或畫面閃爍一顆錯的圖示。
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "切換為淺色模式" : "切換為深色模式"}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {isDark ? (
        <Sun size={19} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Moon size={19} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
