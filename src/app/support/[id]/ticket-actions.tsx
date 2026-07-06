"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Transition = { value: string; label: string };

const TRANSITION_LABEL: Record<string, string> = {
  in_progress: "標記處理中",
  resolved: "標記已解決",
  closed: "結案",
};

// 留言跟進表單（本人與 moderator/admin 都能用）＋moderator/admin 專屬的狀態轉換按鈕。
// 比照 src/app/items/[id]/claims-section.tsx 的 client component 慣例：本頁伺服器端已經
// 用 canViewSupportTicket 擋過權限，這裡拿到的 props 都是「有權限看到」前提下的資料。
export function TicketActions({
  ticketId,
  allowedTransitions,
  canModerate,
}: {
  ticketId: string;
  allowedTransitions: Transition[];
  canModerate: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function postEvent(body: Record<string, unknown>) {
    setError("");
    try {
      const res = await fetch(`/api/support-tickets/${ticketId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setMessage("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 1 || submitting) return;
    setSubmitting(true);
    await postEvent({ message });
    setSubmitting(false);
  }

  async function submitTransition(toStatus: string) {
    if (pendingStatus) return;
    setPendingStatus(toStatus);
    await postEvent({ toStatus });
    setPendingStatus(null);
  }

  return (
    <div className="mt-6 space-y-4">
      {canModerate && allowedTransitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allowedTransitions.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant="outline"
              size="sm"
              disabled={pendingStatus !== null}
              onClick={() => submitTransition(t.value)}
            >
              {pendingStatus === t.value ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                (TRANSITION_LABEL[t.value] ?? t.label)
              )}
            </Button>
          ))}
        </div>
      )}

      <form onSubmit={submitComment} className="space-y-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="留言跟進（例如補充狀況、詢問處理進度）"
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" disabled={message.trim().length < 1 || submitting}>
          {submitting ? "送出中…" : "送出留言"}
        </Button>
      </form>
    </div>
  );
}
