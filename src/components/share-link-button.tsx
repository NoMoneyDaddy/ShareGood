"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// 參考 GiveCircle 物品詳情頁的分享列（docs/research/2026-07-07-launch/
// 05-givecircle-reference.md）：把「分享出去」做成隨手可按的獨立按鈕，
// 而不是只能靠使用者自己複製網址列——多一個擴散管道對免費共享平台的成交率有實感幫助。
// 優先用 Web Share API（手機瀏覽器多半支援，可以直接叫出系統分享面板分享到 LINE／
// Threads 等），不支援時 fallback 成複製連結到剪貼簿＋按鈕文字提示 2 秒。
// 刻意不依賴 sonner Toaster（尚未掛上 Provider，見 theme-provider.tsx 註解），
// 用按鈕自身文字切換當回饋，維持零依賴。
export function ShareLinkButton({ title, className }: { title: string; className?: string }) {
  const [justCopied, setJustCopied] = useState(false);

  async function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // 使用者取消分享面板或裝置不支援時，落到下面的複製連結 fallback。
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2000);
    } catch {
      // 複製失敗（例如非 HTTPS 或權限被擋）就靜默略過，不阻擋使用者繼續瀏覽。
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label="分享這個物品"
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {justCopied ? (
        <>
          <Check size={15} strokeWidth={2.4} aria-hidden="true" className="text-success" />
          已複製連結
        </>
      ) : (
        <>
          <Share2 size={15} strokeWidth={2.2} aria-hidden="true" />
          分享
        </>
      )}
    </button>
  );
}
