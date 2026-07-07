"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DealSource = {
  id: string;
  name: string;
  officialUrl: string;
  sourceGrade: string;
  lastCheckedAt: string | null;
  isActive: boolean;
  notes: string | null;
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
});

// 好康來源清單＋新增表單＋逐列「標記已查證」（master-plan §9a 交付內容 2）。呼叫既有的
// GET/POST /api/admin/deal-sources 與 PATCH /api/admin/deal-sources/[id]，這裡只管
// UI 呈現與呼叫時機，權限判斷全部留在 API 層把關（比照 src/app/admin/reports/reports-panel.tsx）。
export function DealSourcesPanel() {
  const [sources, setSources] = useState<DealSource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/deal-sources");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "載入來源清單失敗");
        return;
      }
      setSources(data.sources as DealSource[]);
    } catch {
      setError("網路連線異常，請重新整理再試一次");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <NewSourceForm onCreated={load} />

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-4 space-y-3">
        {sources === null && loading && (
          <p className="py-8 text-center text-sm text-ink-soft">載入中…</p>
        )}
        {sources !== null && sources.length === 0 && (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            目前沒有任何來源
          </p>
        )}
        {sources?.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            onUpdated={(updated) =>
              setSources((prev) =>
                prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function NewSourceForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/admin/deal-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, officialUrl, notes: notes || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "新增失敗");
        return;
      }
      setName("");
      setOfficialUrl("");
      setNotes("");
      onCreated();
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-card p-4">
      <p className="text-sm font-medium text-ink">新增來源</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="來源名稱"
          required
        />
        <Input
          type="url"
          value={officialUrl}
          onChange={(e) => setOfficialUrl(e.target.value)}
          placeholder="官方頁網址"
          required
        />
      </div>
      <Input
        className="mt-2"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="收錄注意事項（選填）"
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" className="mt-3" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : "新增"}
      </Button>
    </form>
  );
}

function SourceCard({
  source,
  onUpdated,
}: {
  source: DealSource;
  onUpdated: (updated: DealSource) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function markVerified() {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/deal-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markVerified: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "操作失敗");
        return;
      }
      onUpdated(data as DealSource);
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive() {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/deal-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !source.isActive }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "操作失敗");
        return;
      }
      onUpdated(data as DealSource);
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn("rounded-xl border border-line bg-card p-4", !source.isActive && "opacity-60")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {source.name} <span className="text-xs text-ink-soft">（{source.sourceGrade}）</span>
          </p>
          <a
            href={source.officialUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-xs text-brand-ink underline-offset-2 hover:underline"
          >
            {source.officialUrl}
          </a>
          {source.notes && <p className="mt-1 text-xs text-ink-soft">{source.notes}</p>}
          <p className="mt-1 text-xs text-ink-soft">
            上次查證日期：
            {source.lastCheckedAt
              ? TAIPEI_FORMATTER.format(new Date(source.lastCheckedAt))
              : "尚未查證"}
          </p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={markVerified}>
          標記已查證
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={toggleActive}>
          {source.isActive ? "停用" : "啟用"}
        </Button>
      </div>
    </div>
  );
}
