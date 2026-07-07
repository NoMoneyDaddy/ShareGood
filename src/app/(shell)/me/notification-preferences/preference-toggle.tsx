"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type PreferenceToggleProps = {
  eventType: string;
  channel: "inApp" | "external";
  initialEnabled: boolean;
  label: string;
};

// 單一開關：樂觀更新畫面，PATCH 失敗就把狀態改回原本的值（比照 notification-row.tsx
// 的樂觀更新寫法，但這裡失敗要復原，因為使用者盯著這個畫面等結果，不像通知列表點了就走）。
export function PreferenceToggle({
  eventType,
  channel,
  initialEnabled,
  label,
}: PreferenceToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);

  async function handleToggle() {
    if (pending) return;
    const previousEnabled = enabled;
    const next = !previousEnabled;
    setEnabled(next);
    setPending(true);
    try {
      const res = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          [channel === "inApp" ? "inAppEnabled" : "externalEnabled"]: next,
        }),
      });
      if (!res.ok) setEnabled(previousEnabled);
    } catch {
      setEnabled(previousEnabled);
    } finally {
      setPending(false);
    }
  }

  return (
    // 開關本身視覺尺寸維持 24×40px（比照原本設計），但按鈕本身撐到 44×44px 觸控目標
    // （WCAG 2.5.5），track 只是置中在按鈕內的視覺呈現，不是實際的可點擊邊界。
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={pending}
      onClick={handleToggle}
      className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-6 w-10 items-center rounded-full transition-colors",
          enabled ? "bg-brand" : "bg-line",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
