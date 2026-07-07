"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type BackBarProps = {
  // 找不到可回退的瀏覽紀錄時要導去哪裡（例如 `/items`、`/deal-infos`、`/me`）。
  fallbackHref: string;
  // 按鈕文字，預設「返回」；deep link 有明確去處時可傳更具體的敘述（例如
  // `回到「${item.title}」`），沿用 conversations/[id] 頁原本手刻連結的文案慣例。
  label?: string;
};

// 共用返回列（使用者實測回饋：深頁缺少「回首頁」「上一頁」之類的導覽退路）。
//
// 定位：只處理「上一步」語意，刻意跟 (shell) layout 既有的 SiteHeader（logo 可回首頁）
// 分工，不重複——這裡輕量單行、行動版優先，不做成第二個 header。
//
// hasHistory 判斷：History API 沒有「上一頁是否存在」的可靠查詢方式，這裡用
// `window.history.state?.idx`（Next.js App Router 對本分頁內每一筆 history entry
// 寫入的內部索引）是否 > 0 當代理值——0 代表這是這個分頁在本站累積的第一筆記錄
// （直接貼網址、外部連結或分享連結進來），此時 `router.back()` 只會離開網站或什麼
// 都不做，改用 `fallbackHref`。用 useEffect 而非直接在 render 時讀 window，避免
// SSR/首次 hydration 時的 window 不存在錯誤。
export function BackBar({ fallbackHref, label = "返回" }: BackBarProps) {
  const router = useRouter();
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    setHasHistory(typeof idx === "number" && idx > 0);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        if (hasHistory) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="-ml-2 mb-4 flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ArrowLeft size={18} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </button>
  );
}
