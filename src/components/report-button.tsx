"use client";

import { Flag, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_EVIDENCE = 3;

// 對應 prisma schema 的 ReportCategory enum（master-plan §7 第 2 項列出的六種分類）。
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "fraud", label: "詐騙" },
  { value: "private_payment", label: "私下收費" },
  { value: "prohibited_item", label: "違禁品" },
  { value: "food_safety", label: "食品疑慮" },
  { value: "harassment", label: "騷擾" },
  { value: "other", label: "其他" },
];

// 檢舉目標三選一，對應 POST /api/reports 的 itemId／claimCommentId／messageId 欄位。
export type ReportTarget = { itemId: string } | { claimCommentId: string } | { messageId: string };

type EvidenceSlot = {
  key: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  objectId?: string;
  error?: string;
};

/**
 * 通用檢舉觸發按鈕：預設顯示一顆小小的「檢舉」文字按鈕，點下去展開表單（分類／說明／
 * 最多 3 張證據圖片），送出成功後收合並顯示已送出提示。同一顆元件供物品詳情頁（檢舉物品）、
 * 留言列表（檢舉留言）、私訊對話串（檢舉訊息）共用，只是傳入的 target 不同（master-plan §7
 * 第 2 項：對物品/留言/私訊檢舉皆走同一支 API）。
 */
export function ReportButton({
  target,
  label = "檢舉",
  className,
}: {
  target: ReportTarget;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <p className={cn("text-xs text-ink-soft", className)}>已收到你的檢舉，我們會盡快處理</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-ink-soft transition hover:text-destructive",
          className,
        )}
      >
        <Flag size={12} aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <ReportForm
      target={target}
      onCancel={() => setOpen(false)}
      onSuccess={() => {
        setOpen(false);
        setDone(true);
      }}
    />
  );
}

function ReportForm({
  target,
  onCancel,
  onSuccess,
}: {
  target: ReportTarget;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState<EvidenceSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function addEvidence(files: FileList | null) {
    if (!files) return;
    const room = MAX_EVIDENCE - evidence.length;
    const picked = Array.from(files).slice(0, room);

    const newSlots = picked.map((file) => {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.push(previewUrl);
      return { key, previewUrl, file };
    });

    setEvidence((prev) => [
      ...prev,
      ...newSlots.map(({ key, previewUrl }) => ({ key, previewUrl, status: "uploading" as const })),
    ]);

    await Promise.all(
      newSlots.map(async ({ key, file }) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/reports/attachments", { method: "POST", body: form });
          const data = await res.json().catch(() => null);
          setEvidence((prev) =>
            prev.map((e) =>
              e.key !== key
                ? e
                : res.ok && data?.id
                  ? { ...e, status: "done", objectId: data.id }
                  : { ...e, status: "error", error: data?.error?.message ?? "上傳失敗" },
            ),
          );
        } catch {
          setEvidence((prev) =>
            prev.map((e) =>
              e.key !== key ? e : { ...e, status: "error", error: "上傳失敗，請檢查網路連線" },
            ),
          );
        }
      }),
    );
  }

  function removeEvidence(key: string) {
    setEvidence((prev) => {
      const found = prev.find((e) => e.key === key);
      if (found) {
        URL.revokeObjectURL(found.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== found.previewUrl);
      }
      return prev.filter((e) => e.key !== key);
    });
  }

  const readyEvidence = evidence.filter(
    (e): e is EvidenceSlot & { objectId: string } => e.status === "done" && !!e.objectId,
  );
  const hasUploading = evidence.some((e) => e.status === "uploading");
  const canSubmit =
    category.length > 0 &&
    description.trim().length >= 1 &&
    description.trim().length <= 1000 &&
    !hasUploading &&
    !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...target,
          category,
          description,
          evidenceObjectIds: readyEvidence.map((ev) => ev.objectId),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onSuccess();
      } else {
        setError(data?.error?.message ?? "檢舉送出失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 space-y-2 rounded-lg border border-line bg-paper-2 p-3 text-left"
    >
      <select
        aria-label="檢舉分類"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        required
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      >
        <option value="">請選擇檢舉分類</option>
        {CATEGORY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <textarea
        aria-label="檢舉說明"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="請描述發生了什麼事（1–1000 字）"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />

      <div className="flex flex-wrap gap-2">
        {evidence.map((ev) => (
          <div
            key={ev.key}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-paper"
          >
            {/* biome-ignore lint/performance/noImgElement: 本機選檔的暫時預覽（blob: URL），不是可最佳化的遠端圖片 */}
            <img src={ev.previewUrl} alt="" className="h-full w-full object-cover" />
            {ev.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink/40">
                <Loader2 size={16} className="animate-spin text-white" aria-hidden="true" />
              </div>
            )}
            {ev.status === "error" && (
              <div className="absolute inset-0 flex items-center justify-center bg-destructive/80 p-1 text-center text-[9px] text-white">
                {ev.error}
              </div>
            )}
            <button
              type="button"
              onClick={() => removeEvidence(ev.key)}
              aria-label="移除這張證據圖片"
              className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink/60 text-white"
            >
              <X size={10} aria-hidden="true" />
            </button>
          </div>
        ))}
        {evidence.length < MAX_EVIDENCE && (
          <label className="flex h-16 w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line text-[10px] text-ink-soft">
            <span className="text-base leading-none">＋</span>
            證據
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addEvidence(e.target.files);
                e.target.value = "";
              }}
              className="sr-only"
            />
          </label>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={!canSubmit}>
          {submitting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            "送出檢舉"
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          取消
        </Button>
      </div>
    </form>
  );
}
