"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "待複審",
  approved: "已核准",
  rejected: "已駁回",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  pending: "default",
  approved: "outline",
  rejected: "secondary",
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "pending", label: "待複審" },
  { value: "approved", label: "已核准" },
  { value: "rejected", label: "已駁回" },
];

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

type AppealListItem = {
  id: string;
  userId: string;
  itemRemovalId: string | null;
  userRestrictionId: string | null;
  reason: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

type AppealDetail = AppealListItem & {
  itemRemoval: {
    id: string;
    reason: string;
    note: string | null;
    createdAt: string;
    item: { id: string; title: string; status: string };
  } | null;
  userRestriction: {
    id: string;
    type: string;
    reason: string;
    expiresAt: string | null;
    liftedAt: string | null;
  } | null;
  evidence: { storageObjectId: string; objectKey: string }[];
};

// 申訴列表＋複審面板：呼叫既有的 GET /api/appeals?scope=all（列表）、
// GET /api/appeals/[id]（展開時查詳情，含下架/限制紀錄與附件）、
// PATCH /api/appeals/[id]（核准／駁回），不重寫這幾支 API 本身的邏輯。呼叫端
// （../appeals/page.tsx）已經把這個頁面收窄到只有 admin 進得來，這裡不用再另外收 props。
export function AppealsPanel() {
  const [status, setStatus] = useState("pending");
  const [appeals, setAppeals] = useState<AppealListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (opts: { status: string; cursor?: string; append?: boolean }) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ scope: "all" });
      if (opts.status) qs.set("status", opts.status);
      if (opts.cursor) qs.set("cursor", opts.cursor);
      const res = await fetch(`/api/appeals?${qs.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "載入申訴列表失敗");
        return;
      }
      setAppeals((prev) =>
        opts.append && prev ? [...prev, ...data.appeals] : (data.appeals as AppealListItem[]),
      );
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError("網路連線異常，請重新整理再試一次");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ status });
  }, [status, load]);

  function replace(updated: AppealListItem) {
    setAppeals((prev) => (prev ? prev.map((a) => (a.id === updated.id ? updated : a)) : prev));
  }

  return (
    <div>
      <nav className="flex flex-wrap gap-2" aria-label="依狀態篩選">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || "all"}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              status === tab.value
                ? "border-brand bg-brand/10 font-medium text-brand-ink"
                : "border-line text-ink-soft hover:bg-paper-2",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-4 space-y-3">
        {appeals === null && loading && (
          <p className="py-8 text-center text-sm text-ink-soft">載入中…</p>
        )}
        {appeals !== null && appeals.length === 0 && (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            目前沒有符合條件的申訴
          </p>
        )}
        {appeals?.map((appeal) => (
          <AppealRow key={appeal.id} appeal={appeal} onUpdated={replace} />
        ))}
      </div>

      {nextCursor && (
        <div className="mt-4 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => load({ status, cursor: nextCursor, append: true })}
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              "載入更多"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function AppealRow({
  appeal,
  onUpdated,
}: {
  appeal: AppealListItem;
  onUpdated: (updated: AppealListItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<AppealDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState("");

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/appeals/${appeal.id}`);
        const data = await res.json().catch(() => null);
        if (res.ok) setDetail(data as AppealDetail);
        else setError(data?.error?.message ?? "載入詳情失敗");
      } catch {
        setError("網路連線異常，請再試一次");
      } finally {
        setDetailLoading(false);
      }
    }
  }

  async function review(nextStatus: "approved" | "rejected") {
    if (reviewNote.trim().length < 1) {
      setError("複審備註為必填");
      return;
    }
    setPending(nextStatus);
    setError("");
    try {
      const res = await fetch(`/api/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, reviewNote: reviewNote.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
        return;
      }
      onUpdated({
        ...appeal,
        status: data.status,
        reviewNote: data.reviewNote,
        reviewedAt: data.reviewedAt,
      });
      setDetail((prev) =>
        prev ? { ...prev, status: data.status, reviewNote: data.reviewNote } : prev,
      );
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(null);
    }
  }

  const typeLabel = appeal.itemRemovalId ? "下架申訴" : "限制申訴";

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <button
        type="button"
        onClick={toggleExpand}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-soft">{typeLabel}</p>
          <p className="mt-1 line-clamp-2 text-sm text-ink">{appeal.reason}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {TAIPEI_FORMATTER.format(new Date(appeal.createdAt))}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[appeal.status] ?? "outline"}>
          {STATUS_LABEL[appeal.status] ?? appeal.status}
        </Badge>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          {detailLoading && <p className="text-ink-soft">載入詳情中…</p>}
          {detail?.itemRemoval && (
            <p className="text-ink-soft">
              對應下架物品：
              <Link
                href={`/items/${detail.itemRemoval.item.id}`}
                className="text-brand-ink underline-offset-4 hover:underline"
              >
                {detail.itemRemoval.item.title}
              </Link>
              （下架原因：{detail.itemRemoval.reason}）
            </p>
          )}
          {detail?.userRestriction && (
            <p className="text-ink-soft">
              對應限制：{detail.userRestriction.type}（原因：{detail.userRestriction.reason}）
              {detail.userRestriction.liftedAt && "・已解除"}
            </p>
          )}
          {detail && detail.evidence.length > 0 && (
            <p className="text-ink-soft">附件 {detail.evidence.length} 張</p>
          )}
          {appeal.reviewNote && (
            <p className="rounded-lg bg-paper-2 px-2 py-1.5 text-xs text-ink-soft">
              複審備註：{appeal.reviewNote}
            </p>
          )}

          {appeal.status === "pending" && (
            <div className="space-y-2 pt-1">
              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="複審備註（必填）"
                className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="brand"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => review("approved")}
                >
                  {pending === "approved" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    "核准並復原"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => review("rejected")}
                >
                  {pending === "rejected" ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    "駁回"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
