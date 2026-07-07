"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

type SubscriptionFormProps = {
  categories: Option[];
  cities: Option[];
};

const MAX_KEYWORDS = 5;

// 新增訂閱表單（master-plan §6a 交付內容 3、10）：關鍵字（最多 5 個，逗號或 Enter 分隔）、
// 分類／縣市多選、即時通知／每日摘要開關。三個篩選維度至少要設定一項，跟後端驗證一致；
// 這裡先做基本檢查，真正的權威驗證仍在 API（不能只靠前端）。
export function SubscriptionForm({ categories, cities }: SubscriptionFormProps) {
  const router = useRouter();
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [immediateEnabled, setImmediateEnabled] = useState(false);
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value) return;
    if (keywords.length >= MAX_KEYWORDS) {
      setError(`關鍵字最多 ${MAX_KEYWORDS} 個`);
      return;
    }
    if (!keywords.includes(value)) {
      setKeywords([...keywords, value]);
    }
    setKeywordInput("");
  }

  function toggleId(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (keywords.length === 0 && categoryIds.length === 0 && cityIds.length === 0) {
      setError("關鍵字／分類／縣市至少要設定一項");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          immediateEnabled,
          dailyDigestEnabled,
          keywords,
          categoryIds,
          cityIds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "建立訂閱失敗，請稍後再試");
        return;
      }
      setKeywords([]);
      setKeywordInput("");
      setCategoryIds([]);
      setCityIds([]);
      setLabel("");
      setImmediateEnabled(false);
      setDailyDigestEnabled(true);
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-ink">新增訂閱</h2>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subscription-label">自訂名稱（選填）</Label>
        <Input
          id="subscription-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例：台北的腳踏車"
          maxLength={50}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subscription-keyword">關鍵字（最多 {MAX_KEYWORDS} 個）</Label>
        <div className="flex gap-2">
          <Input
            id="subscription-keyword"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="輸入後按 Enter 新增"
          />
          <Button type="button" variant="outline" onClick={addKeyword}>
            新增
          </Button>
        </div>
        {keywords.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => setKeywords(keywords.filter((v) => v !== k))}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-soft/50 px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-soft/70"
                >
                  {k} ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">分類（可複選）</legend>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <CheckboxChip
              key={c.id}
              checked={categoryIds.includes(c.id)}
              onClick={() => toggleId(categoryIds, setCategoryIds, c.id)}
              label={c.name}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink">縣市（可複選）</legend>
        <div className="flex flex-wrap gap-1.5">
          {cities.map((c) => (
            <CheckboxChip
              key={c.id}
              checked={cityIds.includes(c.id)}
              onClick={() => toggleId(cityIds, setCityIds, c.id)}
              label={c.name}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={immediateEnabled}
            onChange={(e) => setImmediateEnabled(e.target.checked)}
            className="size-4 rounded border-line"
          />
          即時通知（符合條件時立刻通知，預設關）
        </label>
        <label className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={dailyDigestEnabled}
            onChange={(e) => setDailyDigestEnabled(e.target.checked)}
            className="size-4 rounded border-line"
          />
          每日摘要（每天彙整一次，預設開）
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" variant="brand" size="xl" disabled={pending}>
        {pending ? "建立中…" : "建立訂閱"}
      </Button>
    </form>
  );
}

function CheckboxChip({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        checked
          ? "border-brand bg-brand-soft/50 text-ink"
          : "border-line bg-paper text-ink-soft hover:bg-paper-2",
      )}
    >
      {label}
    </button>
  );
}
