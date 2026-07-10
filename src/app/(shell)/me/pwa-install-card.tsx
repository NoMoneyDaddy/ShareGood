"use client";

import { Check, Download, Share, SquarePlus } from "lucide-react";
import { useState } from "react";
import { usePwaInstall } from "@/lib/use-pwa-install";

// 「我的」中心頁固定入口（獨立主畫面圖示衍生任務）：全站橫幅（pwa-install-prompt.tsx）
// 一旦被使用者關閉就不會再出現，這張卡片讓當初手滑關掉橫幅、之後又想加到主畫面的人，
// 還能在這裡找到同一套流程；已加入主畫面時改顯示完成狀態，不再重複邀請。
export function PwaInstallCard() {
  const { mounted, platform, isStandalone, canPromptInstall, promptInstall } = usePwaInstall();
  const [showIosSteps, setShowIosSteps] = useState(false);

  // 尚未確定瀏覽器環境前（SSR／首次 hydration）不渲染，避免答案錯誤的骨架畫面。
  if (!mounted) return null;

  if (isStandalone) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-card p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
          aria-hidden="true"
        >
          <Check size={19} strokeWidth={2} />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">已加入主畫面</span>
          <span className="block text-xs text-ink-soft">你現在就是用這個模式在使用 ShareGood。</span>
        </span>
      </div>
    );
  }

  // 桌面版瀏覽器（不是 iOS，也沒有 beforeinstallprompt 可用）不顯示，
  // 避免出現一張按了沒反應的卡片。
  if (platform !== "ios" && !canPromptInstall) return null;

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <button
        type="button"
        onClick={() => (platform === "ios" ? setShowIosSteps((v) => !v) : promptInstall())}
        aria-expanded={platform === "ios" ? showIosSteps : undefined}
        className="flex w-full items-center gap-3 text-left focus-visible:outline-hidden"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
          aria-hidden="true"
        >
          <Download size={19} strokeWidth={1.75} />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">加到主畫面</span>
          <span className="block text-xs text-ink-soft">
            像 App 一樣一鍵打開 ShareGood，不用每次都找瀏覽器分頁。
          </span>
        </span>
      </button>

      {platform === "ios" && showIosSteps && (
        <ol className="mt-3 flex flex-col gap-2 rounded-lg bg-paper-2 p-3 text-sm text-ink">
          <li className="flex items-center gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-ink-soft"
              aria-hidden="true"
            >
              <Share size={14} strokeWidth={2} />
            </span>
            點 Safari 下方工具列的「分享」圖示
          </li>
          <li className="flex items-center gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-ink-soft"
              aria-hidden="true"
            >
              <SquarePlus size={14} strokeWidth={2} />
            </span>
            往下滑，選「加入主畫面」
          </li>
        </ol>
      )}
    </div>
  );
}
