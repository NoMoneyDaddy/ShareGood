"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Claim = {
  id: string;
  message: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  user: { nickname: string };
};

const STATUS_LABEL: Record<string, string> = {
  published: "",
  reserved: "這個物品已經有人認領囉",
  handover_pending: "這個物品正在交接中",
  completed: "這個物品已經完成分享",
  expired: "這個物品已經下架",
  removed_by_user: "這個物品已經下架",
  draft: "",
  pending_review: "",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export function ClaimsSection({ itemId, itemStatus }: { itemId: string; itemStatus: string }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [currentStatus, setCurrentStatus] = useState(itemStatus);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${itemId}/claims`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) setClaims(data.claims);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const canSubmit = message.trim().length >= 1 && message.trim().length <= 500 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch(`/api/items/${itemId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setMessage("");
        if (data.status === "accepted") setCurrentStatus("reserved");
        await loadClaims();
      } else {
        setFormError(data?.error?.message ?? "留言失敗，請再試一次");
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  const statusNotice = STATUS_LABEL[currentStatus];

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-lg font-bold tracking-tight">留言</h2>

      {currentStatus === "published" ? (
        <form onSubmit={submit} className="mt-4 space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="留言表達你想要這個好物（第一則留言會自動被接受）"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" variant="brand" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                送出中…
              </>
            ) : (
              "送出留言"
            )}
          </Button>
        </form>
      ) : (
        statusNotice && (
          <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
            {statusNotice}
          </p>
        )
      )}

      <ul className="mt-6 space-y-3">
        {loading && claims.length === 0 && <li className="text-sm text-ink-soft">載入中…</li>}
        {!loading && claims.length === 0 && (
          <li className="text-sm text-ink-soft">還沒有留言，當第一個留言的人吧</li>
        )}
        {claims.map((claim) => (
          <li key={claim.id} className="rounded-xl border border-line bg-card p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{claim.user.nickname}</span>
              <span className="text-xs text-ink-soft">{formatTime(claim.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{claim.message}</p>
            {claim.status === "accepted" && (
              <span className="mt-2 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-ink">
                已被認領
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
