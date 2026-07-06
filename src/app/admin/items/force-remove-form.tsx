"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 強制下架表單：呼叫既有的 PATCH /api/items/[id]/force-remove（必填原因，備註選填），
// 不重寫那支 API 本身的轉態／audit log／通知邏輯。成功後 router.refresh() 讓伺服器端
// 重新查詢，該物品會因為狀態變成終態而不再顯示這顆表單。
export function ForceRemoveForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
          強制下架
        </Button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 1 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/force-remove`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "下架失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-line pt-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="下架原因（必填，1–500 字）"
        className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder="備註（選填，最多 1000 字）"
        className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={reason.trim().length < 1 || submitting}
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            "確認下架"
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
