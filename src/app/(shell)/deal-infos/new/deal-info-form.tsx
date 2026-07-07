"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const TITLE_MAX = 100;
const SUMMARY_MAX = 2000;

type City = { id: string; name: string };
type DealSource = { id: string; name: string };

// DealInfo 投稿表單（master-plan §9a 交付內容 1／2）。一般使用者只會看到「投稿」欄位；
// moderator/admin 額外看到「人工收錄」開關——打開後改用 sourceType=editorial 並指定
// dealSourceId（交付內容 2 的官方來源清單），提交者不會被記成 submitterId（比照 API
// 端 schema 註解：editorial 收錄由編輯建立，submitterId 為 null）。
export function DealInfoForm({
  cities,
  isModerator,
  dealSources,
}: {
  cities: City[];
  isModerator: boolean;
  dealSources: DealSource[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isNationwide, setIsNationwide] = useState(false);
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [isEditorial, setIsEditorial] = useState(false);
  const [dealSourceId, setDealSourceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  function toggleCity(id: string) {
    setCityIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  const canSubmit =
    title.trim().length >= 2 &&
    title.trim().length <= TITLE_MAX &&
    summary.trim().length >= 1 &&
    summary.trim().length <= SUMMARY_MAX &&
    sourceUrl.trim().length > 0 &&
    (isNationwide || cityIds.length > 0) &&
    expiresAt.length > 0 &&
    (!isEditorial || dealSourceId.length > 0) &&
    !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/deal-infos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim(),
          sourceUrl: sourceUrl.trim(),
          sourceType: isEditorial ? "editorial" : "user_submission",
          ...(isEditorial ? { dealSourceId } : {}),
          isNationwide,
          ...(isNationwide ? {} : { cityIds }),
          expiresAt,
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        router.push(`/deal-infos/${data.id}`);
        router.refresh();
      } else {
        setFormError(data?.error?.message ?? "投稿失敗，請再試一次");
        setSubmitting(false);
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <div className="space-y-2">
        <Label htmlFor="deal-title">標題（2–{TITLE_MAX} 字）</Label>
        <Input
          id="deal-title"
          className="h-11"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={2}
          maxLength={TITLE_MAX}
          placeholder="例：麥當勞現正推出：大薯買一送一"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="deal-summary">自寫摘要</Label>
        <textarea
          id="deal-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={SUMMARY_MAX}
          rows={4}
          placeholder="請用自己的話轉述活動內容（禁止複製官方圖文/文案）"
          required
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="deal-source-url">來源連結</Label>
        <Input
          id="deal-source-url"
          type="url"
          inputMode="url"
          className="h-11"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="deal-expires-at">到期日</Label>
        <Input
          id="deal-expires-at"
          type="date"
          className="h-11"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isNationwide}
            onChange={(e) => setIsNationwide(e.target.checked)}
            className="size-4 rounded border-line"
          />
          全台適用
        </label>
        {!isNationwide && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-ink">適用縣市（可複選）</legend>
            <div className="flex flex-wrap gap-1.5">
              {cities.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={cityIds.includes(c.id)}
                  onClick={() => toggleCity(c.id)}
                  className={cn(
                    "min-h-8 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    cityIds.includes(c.id)
                      ? "border-brand bg-brand-soft/50 text-ink"
                      : "border-line bg-paper text-ink-soft hover:bg-paper-2",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {isModerator && (
        <div className="space-y-3 rounded-xl border border-line bg-card p-4">
          <label className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={isEditorial}
              onChange={(e) => setIsEditorial(e.target.checked)}
              className="size-4 rounded border-line"
            />
            以編輯身分人工收錄——關聯官方來源、直接發布不進審核佇列
          </label>
          {isEditorial && (
            <div className="space-y-2">
              <Label htmlFor="deal-source">官方來源</Label>
              <select
                id="deal-source"
                value={dealSourceId}
                onChange={(e) => setDealSourceId(e.target.value)}
                required
                className="h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              >
                <option value="">請選擇</option>
                {dealSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" variant="brand" size="xl" className="w-full" disabled={!canSubmit}>
        {submitting ? "送出中…" : "送出"}
      </Button>
    </form>
  );
}
