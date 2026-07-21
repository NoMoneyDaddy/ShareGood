"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

type LeaderboardOptOutSectionProps = {
  nickname: string;
  cityId: string | null;
  initialOptOut: boolean;
};

// 排行榜 opt-out（master-plan §10a 交付內容 4，docs/plan/m12-product-growth.md）：單一全站
// 開關，掛在既有 POST /api/profile（沿用暱稱／縣市欄位，選填帶上 leaderboardOptOut）。
// 貢獻值依然照算，只是 /leaderboard 撈不到這個人；/u/[userId] 個人頁不受影響。
export function LeaderboardOptOutSection({
  nickname,
  cityId,
  initialOptOut,
}: LeaderboardOptOutSectionProps) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    const next = !optOut;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, cityId, leaderboardOptOut: next }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setOptOut(next);
      } else {
        setError(data?.error?.message ?? "更新失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={optOut}
          onChange={toggle}
          disabled={pending}
          className="mt-0.5 size-5 shrink-0 accent-brand"
          aria-label="不出現在排行榜"
        />
        <span className="flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            不出現在排行榜
            {pending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            你的貢獻值依然照算，只是不會出現在公開排行榜上；個人頁的分享足跡不受影響。
          </span>
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
