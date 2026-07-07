"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type DealInfoSummary = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  cities: string;
  expiresAt: string;
  createdAt: string;
  submitterNickname: string;
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// 待審好康單列＋核准/駁回（master-plan §9a 交付內容 2）。呼叫既有 PATCH
// /api/deal-infos/[id]，成功後 router.refresh() 讓伺服器元件重新查詢，這筆自然從
// pending_review 佇列消失（比照 src/app/admin/data/retention-policy-row.tsx 的
// 「client row 呼叫 API＋router.refresh()」慣例，而非 reports-panel.tsx 整包用
// client state 管理列表——這裡的佇列資料本身是伺服器元件查的，不需要重複一份 client state）。
export function DealReviewRow({ dealInfo }: { dealInfo: DealInfoSummary }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");

  async function transition(nextStatus: "published" | "rejected", action: "approve" | "reject") {
    setPending(action);
    setError("");
    try {
      const res = await fetch(`/api/deal-infos/${dealInfo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "操作失敗，請再試一次");
        setPending(null);
      }
    } catch {
      setError("網路連線異常，請再試一次");
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-xs text-ink-soft">
        投稿者：{dealInfo.submitterNickname}・{dealInfo.cities}・
        {TAIPEI_FORMATTER.format(new Date(dealInfo.createdAt))}
      </p>
      <Link
        href={`/deal-infos/${dealInfo.id}`}
        className="mt-1 block font-medium text-ink underline-offset-2 hover:underline"
      >
        {dealInfo.title}
      </Link>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{dealInfo.summary}</p>
      <a
        href={dealInfo.sourceUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mt-1 block text-xs text-brand-ink underline-offset-2 hover:underline"
      >
        {dealInfo.sourceUrl}
      </a>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending !== null}
          onClick={() => transition("published", "approve")}
        >
          {pending === "approve" ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            "核准"
          )}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={pending !== null}
          onClick={() => transition("rejected", "reject")}
        >
          {pending === "reject" ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            "駁回"
          )}
        </Button>
      </div>
    </div>
  );
}
