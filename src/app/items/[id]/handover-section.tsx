"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type HandoverSectionProps = {
  itemId: string;
  itemStatus: string;
  isOwner: boolean;
  isReceiver: boolean;
  // handover_pending／completed 狀態才有 handoverId／conversationId 可用（見 page.tsx 查詢）。
  handoverId: string | null;
  conversationId: string | null;
  // completed 狀態才有意義：這個物品是否已經有一則感謝留言（見 page.tsx 查詢）。
  hasThanks: boolean;
};

// 交接與私訊區塊：只在物品進入 reserved／handover_pending／completed，且目前登入者是
// 物主或被接受者時顯示。跟 Wave 1 的 ClaimsSection／DirectShareSection 一樣獨立成一個
// client component，只在 page.tsx 加一行 import + 一行元件掛載，避免互相 merge 衝突。
export function HandoverSection({
  itemId,
  itemStatus,
  isOwner,
  isReceiver,
  handoverId,
  conversationId,
  hasThanks,
}: HandoverSectionProps) {
  if (!isOwner && !isReceiver) return null;
  if (
    itemStatus !== "reserved" &&
    itemStatus !== "handover_pending" &&
    itemStatus !== "completed"
  ) {
    return null;
  }

  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="text-lg font-bold tracking-tight">交接與私訊</h2>
      <div className="mt-4">
        {itemStatus === "reserved" && <StartHandoverButton itemId={itemId} />}
        {itemStatus === "handover_pending" &&
          (handoverId && conversationId ? (
            <InProgressHandover
              handoverId={handoverId}
              conversationId={conversationId}
              isOwner={isOwner}
            />
          ) : (
            // 正常情況下 handover_pending 一定有 handoverId／conversationId（page.tsx 查詢
            // 保證同時存在）；這裡是資料異常時的保底提示，避免整塊區域悄悄消失讓人以為
            // 沒有交接功能。
            <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
              無法顯示交接資訊，請重新整理頁面或稍後再試。
            </p>
          ))}
        {itemStatus === "completed" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">已完成分享</p>
            {isReceiver && !hasThanks && <ThanksForm itemId={itemId} />}
          </div>
        )}
      </div>
    </section>
  );
}

function StartHandoverButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/handover/ensure`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.conversationId) {
        router.push(`/conversations/${data.conversationId}`);
      } else {
        setError(data?.error?.message ?? "無法開始交接，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-soft">物品已經確定要交給對方了，點下方按鈕開始私訊約交接。</p>
      <Button type="button" variant="brand" className="mt-3" disabled={loading} onClick={start}>
        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : "前往交接"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function InProgressHandover({
  handoverId,
  conversationId,
  isOwner,
}: {
  handoverId: string;
  conversationId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"complete" | "no-show" | null>(null);
  const [error, setError] = useState("");
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);

  async function markComplete() {
    if (submitting) return;
    setSubmitting("complete");
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/complete`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
    }
  }

  async function markNoShow() {
    if (submitting) return;
    setSubmitting("no-show");
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/no-show`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
      setConfirmingNoShow(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">物品正在交接中，跟對方私訊約時間地點吧。</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/conversations/${conversationId}`}>前往私訊</Link>
        </Button>
        <Button type="button" variant="brand" disabled={submitting !== null} onClick={markComplete}>
          {submitting === "complete" ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            "標記完成"
          )}
        </Button>
        {isOwner &&
          (confirmingNoShow ? (
            <Button
              type="button"
              variant="destructive"
              disabled={submitting !== null}
              onClick={markNoShow}
            >
              {submitting === "no-show" ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                "確定對方沒有出現？"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={submitting !== null}
              onClick={() => setConfirmingNoShow(true)}
            >
              對方沒有出現
            </Button>
          ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// 感謝留言表單：只有接手者、且這個物品還沒有感謝留言時才會被掛載（見上方 HandoverSection）。
// 送出成功後用 router.refresh() 讓 page.tsx 重新查一次 ThanksMessage——ThanksSection 會
// 顯示出新留言，hasThanks 也會跟著變 true 讓這個表單自然消失，不需要另外管理本地已送出狀態。
function ThanksForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = message.trim().length >= 1 && message.trim().length <= 300 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/thanks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setMessage("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "留言失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-sm text-ink-soft">跟物主留言感謝一下吧（限一次）。</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="謝謝你的分享！"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="brand" disabled={!canSubmit}>
        {submitting ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          "送出感謝"
        )}
      </Button>
    </form>
  );
}
