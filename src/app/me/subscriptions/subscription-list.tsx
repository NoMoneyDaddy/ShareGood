"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type SubscriptionListItem = {
  id: string;
  label: string | null;
  immediateEnabled: boolean;
  dailyDigestEnabled: boolean;
  keywords: string[];
  categories: string[];
  cities: string[];
  matchCount: number;
  pendingMatchCount: number;
};

// 訂閱列表（master-plan §6a 交付內容 10）：label／篩選條件摘要／即時開關／每日摘要開關／
// 累積命中數，各自可以刪除。
export function SubscriptionList({ subscriptions }: { subscriptions: SubscriptionListItem[] }) {
  const router = useRouter();

  if (subscriptions.length === 0) {
    return <p className="mt-3 text-sm text-ink-soft">還沒有任何訂閱，新增一筆試試看吧。</p>;
  }

  return (
    <ul className="mt-3 flex flex-col gap-3">
      {subscriptions.map((s) => (
        <SubscriptionCard key={s.id} subscription={s} onChanged={() => router.refresh()} />
      ))}
    </ul>
  );
}

function summarize(s: SubscriptionListItem): string {
  const parts: string[] = [];
  if (s.keywords.length > 0) parts.push(`關鍵字：${s.keywords.join("、")}`);
  if (s.categories.length > 0) parts.push(`分類：${s.categories.join("、")}`);
  if (s.cities.length > 0) parts.push(`縣市：${s.cities.join("、")}`);
  return parts.join(" ・ ");
}

function SubscriptionCard({
  subscription,
  onChanged,
}: {
  subscription: SubscriptionListItem;
  onChanged: () => void;
}) {
  const [immediateEnabled, setImmediateEnabled] = useState(subscription.immediateEnabled);
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(subscription.dailyDigestEnabled);
  const [pending, setPending] = useState(false);

  async function patch(next: { immediateEnabled?: boolean; dailyDigestEnabled?: boolean }) {
    if (pending) return;
    setPending(true);
    try {
      await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: subscription.label,
          immediateEnabled: next.immediateEnabled ?? immediateEnabled,
          dailyDigestEnabled: next.dailyDigestEnabled ?? dailyDigestEnabled,
          keywords: subscription.keywords,
          categoryIds: [],
          cityIds: [],
        }),
      });
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (pending) return;
    if (!window.confirm("確定要刪除這筆訂閱嗎？")) return;
    setPending(true);
    try {
      await fetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {subscription.label || "（未命名訂閱）"}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">{summarize(subscription) || "無篩選條件"}</p>
        </div>
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={pending}>
          刪除
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-soft">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={immediateEnabled}
            disabled={pending}
            onChange={(e) => {
              setImmediateEnabled(e.target.checked);
              patch({ immediateEnabled: e.target.checked });
            }}
            className="size-3.5 rounded border-line"
          />
          即時通知
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={dailyDigestEnabled}
            disabled={pending}
            onChange={(e) => {
              setDailyDigestEnabled(e.target.checked);
              patch({ dailyDigestEnabled: e.target.checked });
            }}
            className="size-3.5 rounded border-line"
          />
          每日摘要
        </label>
        <span>
          累積命中 {subscription.matchCount} 筆（{subscription.pendingMatchCount} 筆待通知）
        </span>
      </div>
    </li>
  );
}
