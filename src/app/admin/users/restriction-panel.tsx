"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const RESTRICTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "no_posting", label: "禁止上架" },
  { value: "no_claiming", label: "禁止留言／認領" },
  { value: "no_messaging", label: "禁止私訊" },
  { value: "full_block", label: "全站封鎖（唯讀）" },
];

const RESTRICTION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RESTRICTION_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// 建立限制表單：呼叫既有的 POST /api/admin/user-restrictions（RBAC 邊界、重複限制檢查、
// audit log 都在那支 API 裡），這裡只負責收欄位跟送出。`disabled` 由呼叫端（頁面）算好
// 傳入（moderator 不能限制 admin 帳號），避免使用者點了才被 API 403 打回來。
export function CreateRestrictionForm({
  userId,
  disabled,
  disabledReason,
}: {
  userId: string;
  disabled: boolean;
  disabledReason: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (disabled) {
    return <p className="text-xs text-ink-soft">{disabledReason}</p>;
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        新增限制
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type || reason.trim().length < 1 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/user-restrictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type,
          reason: reason.trim(),
          ...(expiresAt
            ? { expiresAt: new Date(`${expiresAt}T23:59:59+08:00`).toISOString() }
            : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setOpen(false);
        setType("");
        setReason("");
        setExpiresAt("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "建立限制失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <select
        aria-label="限制類型"
        value={type}
        onChange={(e) => setType(e.target.value)}
        required
        className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      >
        <option value="">請選擇限制類型</option>
        {RESTRICTION_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="限制原因（必填，1–500 字）"
        className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      <label className="flex items-center gap-2 text-xs text-ink-soft">
        到期日（選填，留白代表永久）
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded-lg border border-line bg-paper-2 px-2 py-1 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={!type || reason.trim().length < 1 || submitting}
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            "建立限制"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={submitting}
        >
          取消
        </Button>
      </div>
    </form>
  );
}

// 生效中限制的單行顯示＋解除按鈕：呼叫既有的 DELETE /api/admin/user-restrictions/[id]。
export function LiftRestrictionRow({
  restrictionId,
  type,
  reason,
  expiresAt,
}: {
  restrictionId: string;
  type: string;
  reason: string;
  expiresAt: Date | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function lift() {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/user-restrictions/${restrictionId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "解除失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-soft">
      <span>
        {RESTRICTION_TYPE_LABEL[type] ?? type}・{reason}
        {expiresAt && `・至 ${TAIPEI_FORMATTER.format(expiresAt)}`}
        {error && <span className="ml-2 text-destructive">{error}</span>}
      </span>
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={lift}>
        {pending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : "解除"}
      </Button>
    </div>
  );
}
