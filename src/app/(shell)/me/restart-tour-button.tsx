"use client";

import { RotateCcw } from "lucide-react";
import { restartOnboardingTour } from "@/components/onboarding-tour";

// 「重新看一次導覽」入口（M11 規格明訂 /me 中心頁要有這個入口）：`OnboardingTour`
// 已經掛在 (shell)/layout.tsx、跟這個頁面共用同一個 layout 實例，這裡只要送出
// 它監聽的自訂事件即可重新打開，不需要另外傳 prop 或用 context。
export function RestartTourButton() {
  return (
    <button
      type="button"
      onClick={restartOnboardingTour}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-card p-4 text-left transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
        aria-hidden="true"
      >
        <RotateCcw size={19} strokeWidth={1.75} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink">重新看一次導覽</span>
        <span className="block text-xs text-ink-soft">忘記怎麼用了嗎？再看一次新手導覽</span>
      </span>
    </button>
  );
}
