"use client";

import { Rss } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

type IdName = { id: string; name: string };

export type SubscriptionListItem = {
  id: string;
  label: string | null;
  immediateEnabled: boolean;
  dailyDigestEnabled: boolean;
  keywords: string[];
  categories: IdName[];
  cities: IdName[];
  matchCount: number;
  pendingMatchCount: number;
};

// 訂閱列表（master-plan §6a 交付內容 10）：label／篩選條件摘要／即時開關／每日摘要開關／
// 累積命中數，各自可以刪除。
export function SubscriptionList({ subscriptions }: { subscriptions: SubscriptionListItem[] }) {
  const router = useRouter();

  if (subscriptions.length === 0) {
    return (
      <EmptyState
        icon={Rss}
        title="還沒有任何訂閱"
        description="用上面的表單設定關鍵字、分類或縣市，符合的新物品上架後會通知你。"
      />
    );
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
  if (s.categories.length > 0) parts.push(`分類：${s.categories.map((c) => c.name).join("、")}`);
  if (s.cities.length > 0) parts.push(`縣市：${s.cities.map((c) => c.name).join("、")}`);
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
  const [error, setError] = useState<string | null>(null);

  // PATCH /api/subscriptions/[id] 是整包替換語意：漏傳 categoryIds/cityIds 等於把它們清空，
  // 所以這裡一定要把 subscription 目前的分類/縣市 id 原樣送回去，不能只送這次要改的開關欄位。
  async function patch(next: { immediateEnabled?: boolean; dailyDigestEnabled?: boolean }) {
    if (pending) return;
    setPending(true);
    setError(null);
    const prevImmediate = immediateEnabled;
    const prevDailyDigest = dailyDigestEnabled;
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: subscription.label,
          immediateEnabled: next.immediateEnabled ?? immediateEnabled,
          dailyDigestEnabled: next.dailyDigestEnabled ?? dailyDigestEnabled,
          keywords: subscription.keywords,
          categoryIds: subscription.categories.map((c) => c.id),
          cityIds: subscription.cities.map((c) => c.id),
        }),
      });
      if (!res.ok) {
        // 更新失敗要把開關復原成呼叫前的狀態，避免畫面顯示跟後端實際設定不一致。
        setImmediateEnabled(prevImmediate);
        setDailyDigestEnabled(prevDailyDigest);
        setError("更新失敗，請稍後再試");
      }
    } catch {
      setImmediateEnabled(prevImmediate);
      setDailyDigestEnabled(prevDailyDigest);
      setError("網路異常，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (pending) return;
    if (!window.confirm("確定要刪除這筆訂閱嗎？")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("刪除失敗，請稍後再試");
        return;
      }
      onChanged();
    } catch {
      setError("網路異常，請稍後再試");
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

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
        <label className="-mx-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2">
          <input
            type="checkbox"
            checked={immediateEnabled}
            disabled={pending}
            onChange={(e) => {
              setImmediateEnabled(e.target.checked);
              patch({ immediateEnabled: e.target.checked });
            }}
            className="size-4 rounded border-line"
          />
          即時通知
        </label>
        <label className="-mx-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2">
          <input
            type="checkbox"
            checked={dailyDigestEnabled}
            disabled={pending}
            onChange={(e) => {
              setDailyDigestEnabled(e.target.checked);
              patch({ dailyDigestEnabled: e.target.checked });
            }}
            className="size-4 rounded border-line"
          />
          每日摘要
        </label>
        <span className="px-2">
          累積命中 {subscription.matchCount} 筆（{subscription.pendingMatchCount} 筆待通知）
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}
