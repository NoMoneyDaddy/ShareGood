"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type DataExportInfo = {
  id: string;
  status: string;
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
} | null;

const STATUS_LABEL: Record<string, string> = {
  pending: "已送出，等待系統產生中",
  processing: "正在產生匯出包",
  ready: "已就緒，可以下載",
  expired: "已過期並清除",
  failed: "產生失敗，請重新申請",
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null) {
  return iso ? TAIPEI_FORMATTER.format(new Date(iso)) : null;
}

// 資料匯出區塊（master-plan §7a 交付內容 2）：申請按鈕＋目前狀態顯示＋就緒後的下載連結。
// 產生是非同步（排程 job 處理），這裡不會立刻拿到檔案，只負責觸發請求與顯示目前狀態。
export function ExportDataSection({ latest }: { latest: DataExportInfo }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  async function handleRequest() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/data-exports", { method: "POST" });
      if (res.status === 201) {
        setMessage("已送出申請，系統處理完成後會透過站內通知告知你，屆時回來這頁即可下載。");
        router.refresh();
      } else if (res.status === 409) {
        setMessage("24 小時內已經有一筆匯出申請正在處理，請稍後再試。");
      } else {
        setMessage("申請失敗，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDownload() {
    if (!latest) return;
    setPending(true);
    try {
      const res = await fetch(`/api/me/data-exports/${latest.id}/download`);
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        setDownloadUrl(data.url);
        window.location.assign(data.url);
      } else {
        setMessage("取得下載連結失敗，請重新整理頁面再試一次。");
      }
    } finally {
      setPending(false);
    }
  }

  const isNonTerminal = latest && (latest.status === "pending" || latest.status === "processing");

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="text-sm text-ink-soft">
        把你在 ShareGood 留下的資料（物品、留言、直贈、交接、私訊、感謝留言、貢獻值、通知）打包成
        一份 JSON 說明檔，7 天內可下載，逾期自動清除。
      </p>

      {latest && (
        <p className="mt-3 text-sm text-ink">
          目前狀態：{STATUS_LABEL[latest.status] ?? latest.status}
          {latest.expiresAt && latest.status === "ready" && (
            <span className="text-ink-soft">（下載連結有效至 {formatDate(latest.expiresAt)}）</span>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending || !!isNonTerminal} onClick={handleRequest}>
          {pending && <Loader2 className="animate-spin" size={14} aria-hidden="true" />}
          匯出我的資料
        </Button>
        {latest?.status === "ready" && (
          <Button variant="brand" disabled={pending} onClick={handleDownload}>
            下載匯出包
          </Button>
        )}
      </div>

      {message && <p className="mt-2 text-sm text-ink-soft">{message}</p>}
      {downloadUrl && (
        <p className="mt-1 text-xs text-ink-soft">
          若沒有自動開始下載，
          <a href={downloadUrl} className="underline underline-offset-2">
            點此下載
          </a>
          （連結 15 分鐘內有效）。
        </p>
      )}
    </div>
  );
}
