"use client";

import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePwaInstall } from "@/lib/use-pwa-install";

const DISMISS_KEY = "pwa_prompt_dismissed";
const VISIT_KEY = "pwa_visit_count";
const TOUR_DONE_KEY = "tour_done";

// 全站「加到主畫面」橫幅（獨立主畫面圖示衍生任務）：低調、可關閉，不用「安裝 PWA」
// 這種術語，對使用者只講「加到主畫面」。掛在 (shell)/layout.tsx、SiteHeader 之下、
// main 之上，走一般文件流（非 fixed），因此天生不會蓋住底部的 BottomTab（bottom-tab.tsx
// 是 `fixed inset-x-0 bottom-0`，兩者互不重疊，不需要額外算安全區高度）。
//
// 顯示時機（規格明訂「不要一進站就彈」）：初次導覽（onboarding-tour.tsx）優先，這裡
// 用「tour_done 已標記」或「這是第 2 次以上掛載這個殼層」任一成立才視為可顯示。
// App Router 同分頁內的客戶端導覽不會重新掛載 (shell)/layout.tsx，所以這個掛載次數
// 實務上約等於「第幾次重新整理／重新打開這個網站」，足以達成「避免疊加打擾」的目的，
// 不需要為此新增資料庫欄位或跨裝置同步。
export function PwaInstallPrompt() {
  const { mounted, platform, isStandalone, canPromptInstall, promptInstall } = usePwaInstall();
  // 預設關閉（true）：等下面的 effect 讀完 localStorage 才可能翻成 false，
  // 避免還沒判斷完就先閃一下橫幅。
  const [dismissed, setDismissed] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");

    const tourDone = window.localStorage.getItem(TOUR_DONE_KEY) === "true";
    const prevVisits = Number(window.localStorage.getItem(VISIT_KEY) ?? "0");
    const visits = prevVisits + 1;
    window.localStorage.setItem(VISIT_KEY, String(visits));
    setEligible(tourDone || visits >= 2);
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  async function handleInstallClick() {
    const outcome = await promptInstall();
    // 使用者在系統對話框按了「取消」：視同關閉這則提示，不再重複打擾。
    if (outcome === "dismissed") dismiss();
  }

  if (!mounted || isStandalone || dismissed || !eligible) return null;
  // Android/Chrome 等瀏覽器要等 `beforeinstallprompt` 真的觸發才有得按；iOS 沒有
  // 這個事件，改靠下面手動圖解，兩者以外（桌面 Safari/Firefox 等）不顯示。
  if (platform !== "ios" && !canPromptInstall) return null;

  return (
    <div role="region" aria-label="加到主畫面提示" className="border-b border-line bg-brand-soft">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-brand-ink"
          aria-hidden="true"
        >
          <Download size={17} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">把 ShareGood 加到主畫面</p>
          <p className="text-xs text-ink-soft">像 App 一樣一鍵打開，找好物、看訊息更快。</p>
        </div>
        {platform === "ios" ? (
          <button
            type="button"
            onClick={() => setShowIosSteps((v) => !v)}
            aria-expanded={showIosSteps}
            className="flex h-11 shrink-0 items-center rounded-lg border border-brand/40 bg-card px-3 text-sm font-medium text-brand-ink transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            怎麼加？
          </button>
        ) : (
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex h-11 shrink-0 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground transition hover:bg-brand-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            加入
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="關閉這則提示"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {platform === "ios" && showIosSteps && (
        <div className="mx-auto max-w-6xl px-4 pb-3 sm:px-6">
          <ol className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3 text-sm text-ink">
            <li className="flex items-center gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
                aria-hidden="true"
              >
                <Share size={14} strokeWidth={2} />
              </span>
              點 Safari 下方工具列的「分享」圖示
            </li>
            <li className="flex items-center gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
                aria-hidden="true"
              >
                <SquarePlus size={14} strokeWidth={2} />
              </span>
              往下滑，選「加入主畫面」
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
