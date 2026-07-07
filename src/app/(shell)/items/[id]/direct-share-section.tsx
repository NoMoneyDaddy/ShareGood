"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MineShare = { id: string; expiresAt: string };

// 直贈區塊：物主看到「輸入 email 直贈」表單；受贈者看到「你收到一份直接贈與」的接受/婉拒按鈕。
// 獨立成一個 client component，避免跟同步進行的留言/認領功能一起改動 page.tsx 造成 merge 衝突。
export function DirectShareSection({
  itemId,
  itemStatus,
  isOwner,
  lotteryActive = false,
}: {
  itemId: string;
  itemStatus: string;
  isOwner: boolean;
  // M5 抽籤（master-plan §5a 交付內容 2）：物品存在非終態抽籤時，
  // POST .../direct-shares 會回 409，這裡提前隱藏直贈表單。
  lotteryActive?: boolean;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<MineShare | null | undefined>(undefined);

  useEffect(() => {
    if (isOwner) return;
    let cancelled = false;
    fetch(`/api/items/${itemId}/direct-shares/mine`)
      .then((res) => (res.ok ? res.json() : { share: null }))
      .then((data) => {
        if (!cancelled) setMine(data.share ?? null);
      })
      .catch(() => {
        if (!cancelled) setMine(null);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, isOwner]);

  if (isOwner) {
    if (itemStatus !== "published" || lotteryActive) return null;
    return <OwnerDirectShareForm itemId={itemId} />;
  }

  if (!mine) return null;
  return <ReceiverDirectShareCard itemId={itemId} share={mine} onDone={() => router.refresh()} />;
}

function OwnerDirectShareForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/direct-shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverEmail: email.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setSent(true);
        setEmail("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "送出失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink">直接贈與給指定的人</h2>
      <p className="mt-1 text-sm text-ink-soft">
        輸入對方的 email，對方會收到通知，72 小時內可接受或婉拒。
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Label htmlFor="direct-share-email" className="sr-only">
          對方 email
        </Label>
        <Input
          id="direct-share-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="對方的 email"
          required
          className="flex-1"
        />
        <Button type="submit" variant="brand" disabled={submitting || !email.trim()}>
          {submitting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            "送出直贈"
          )}
        </Button>
      </form>
      {sent && <p className="mt-2 text-sm text-brand-ink">已送出直贈邀請</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function ReceiverDirectShareCard({
  itemId,
  share,
  onDone,
}: {
  itemId: string;
  share: MineShare;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);

  async function respond(action: "accept" | "decline") {
    if (submitting) return;
    setSubmitting(action);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/direct-shares/${share.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setResult(action === "accept" ? "accepted" : "declined");
        onDone();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
    }
  }

  if (result === "accepted") {
    return (
      <div className="border-t border-line/70 pt-5 text-sm text-ink first:border-t-0 first:pt-0">
        你已經接受這份直接贈與，接下來請跟分享者約時間交接。
      </div>
    );
  }
  if (result === "declined") {
    return (
      <div className="border-t border-line/70 pt-5 text-sm text-ink-soft first:border-t-0 first:pt-0">
        你已經婉拒這份直接贈與。
      </div>
    );
  }

  return (
    <div className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <div className="rounded-xl border border-brand/40 bg-brand-soft/60 p-4">
        <h2 className="text-sm font-semibold text-brand-ink">你收到一份直接贈與</h2>
        <p className="mt-1 text-sm text-ink-soft">分享者指定要把這件好物贈與給你，要接受嗎？</p>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="brand"
            disabled={submitting !== null}
            onClick={() => respond("accept")}
          >
            {submitting === "accept" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "接受"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => respond("decline")}
          >
            {submitting === "decline" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "婉拒"
            )}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
