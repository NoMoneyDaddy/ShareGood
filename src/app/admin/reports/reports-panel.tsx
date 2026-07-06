"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 與 src/components/report-button.tsx 的 CATEGORY_OPTIONS 同一份分類，繁中標籤集中在
// 這裡維護一份即可（後台頁面沒有共用元件的必要，比照既有慣例各自維護自己的標籤 map）。
const CATEGORY_LABEL: Record<string, string> = {
  fraud: "詐騙",
  private_payment: "私下收費",
  prohibited_item: "違禁品",
  food_safety: "食品疑慮",
  harassment: "騷擾",
  other: "其他",
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "已送出",
  triaged: "已分類",
  in_progress: "處理中",
  resolved: "已解決",
  rejected: "已駁回",
  closed: "已結案",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  submitted: "default",
  triaged: "secondary",
  in_progress: "secondary",
  resolved: "outline",
  rejected: "destructive",
  closed: "outline",
};

// 跟 src/app/api/reports/[id]/route.ts 的 ALLOWED_TRANSITIONS 保持一致：這裡只是拿來畫
// 「目前這個狀態可以轉去哪裡」的按鈕，真正的狀態機檢查仍然是那支 API 在把關。
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ["triaged", "rejected"],
  triaged: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: ["closed"],
  rejected: ["closed"],
  closed: [],
};

const TRANSITION_LABEL: Record<string, string> = {
  triaged: "標記已分類",
  in_progress: "開始處理",
  resolved: "標記已解決",
  rejected: "駁回",
  closed: "結案",
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "submitted", label: "已送出" },
  { value: "triaged", label: "已分類" },
  { value: "in_progress", label: "處理中" },
  { value: "resolved", label: "已解決" },
  { value: "rejected", label: "已駁回" },
  { value: "closed", label: "已結案" },
];

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

type ReportItem = {
  id: string;
  category: string;
  status: string;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporter: { id: string; nickname: string };
  target: {
    itemId: string | null;
    claimCommentId: string | null;
    messageId: string | null;
    item: { id: string; title: string } | null;
    claimComment: { id: string; message: string } | null;
    message: { id: string; body: string } | null;
  };
  evidence: { sortOrder: number; objectKey: string }[];
};

function targetSummary(target: ReportItem["target"]) {
  if (target.item)
    return { label: "物品", text: target.item.title, href: `/items/${target.item.id}` };
  if (target.claimComment) return { label: "留言", text: target.claimComment.message, href: null };
  if (target.message) return { label: "私訊", text: target.message.body, href: null };
  return { label: "未知", text: "（對象已不存在）", href: null };
}

// 檢舉列表＋處理面板：呼叫既有的 GET /api/reports?scope=all（列表與篩選）與
// PATCH /api/reports/[id]（狀態轉換），不重寫這兩支 API 本身的邏輯——這裡只負責 UI 呈現
// 與呼叫時機，權限判斷／狀態機檢查／併發保護全部留在原本的 API 裡。
export function ReportsPanel() {
  const [status, setStatus] = useState("");
  const [reports, setReports] = useState<ReportItem[] | null>(null);
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
      const res = await fetch(`/api/reports?${qs.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "載入檢舉列表失敗");
        return;
      }
      setReports((prev) =>
        opts.append && prev ? [...prev, ...data.reports] : (data.reports as ReportItem[]),
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

  function replaceReport(updated: ReportItem) {
    setReports((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
  }

  function removeReportIfFiltered(id: string, newStatus: string) {
    // 篩選中的分頁：狀態轉換後若不再符合目前篩選條件，直接從畫面上移除，避免顯示過期資料。
    if (status && status !== newStatus) {
      setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    }
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
        {reports === null && loading && (
          <p className="py-8 text-center text-sm text-ink-soft">載入中…</p>
        )}
        {reports !== null && reports.length === 0 && (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            目前沒有符合條件的檢舉
          </p>
        )}
        {reports?.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            onUpdated={(updated) => {
              replaceReport(updated);
              removeReportIfFiltered(report.id, updated.status);
            }}
          />
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

function ReportCard({
  report,
  onUpdated,
}: {
  report: ReportItem;
  onUpdated: (updated: ReportItem) => void;
}) {
  const [note, setNote] = useState(report.resolutionNote ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  const target = targetSummary(report.target);
  const allowed = ALLOWED_TRANSITIONS[report.status] ?? [];

  async function transition(nextStatus: string) {
    const isFinalizing = nextStatus === "resolved" || nextStatus === "rejected";
    if (isFinalizing && note.trim().length < 1) {
      setError("結案（已解決／已駁回）需填寫處理備註");
      return;
    }
    setPending(nextStatus);
    setError("");
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, resolutionNote: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
        return;
      }
      onUpdated({
        ...report,
        status: data.status,
        resolutionNote: data.resolutionNote ?? report.resolutionNote,
        resolvedAt: data.resolvedAt ?? report.resolvedAt,
      });
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-soft">
            {CATEGORY_LABEL[report.category] ?? report.category}・檢舉人：
            {report.reporter.nickname}
          </p>
          <p className="mt-1 text-sm text-ink">
            檢舉對象（{target.label}）：
            {target.href ? (
              <Link
                href={target.href}
                className="text-brand-ink underline-offset-4 hover:underline"
              >
                {target.text}
              </Link>
            ) : (
              <span className="text-ink">{target.text}</span>
            )}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{report.description}</p>
          {report.evidence.length > 0 && (
            <p className="mt-1 text-xs text-ink-soft">附件 {report.evidence.length} 張</p>
          )}
          <p className="mt-1 text-xs text-ink-soft">
            {TAIPEI_FORMATTER.format(new Date(report.createdAt))}
          </p>
          {report.resolutionNote && (
            <p className="mt-2 rounded-lg bg-paper-2 px-2 py-1.5 text-xs text-ink-soft">
              處理備註：{report.resolutionNote}
            </p>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[report.status] ?? "outline"}>
          {STATUS_LABEL[report.status] ?? report.status}
        </Badge>
      </div>

      {allowed.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="處理備註（結案時必填）"
            className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {allowed.map((value) => (
              <Button
                key={value}
                type="button"
                variant={value === "rejected" ? "destructive" : "outline"}
                size="sm"
                disabled={pending !== null}
                onClick={() => transition(value)}
              >
                {pending === value ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  (TRANSITION_LABEL[value] ?? value)
                )}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
