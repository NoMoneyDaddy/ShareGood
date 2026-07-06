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
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={pending}
      onClick={handleToggle}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70",
        enabled ? "bg-brand" : "bg-line",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          enabled ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
