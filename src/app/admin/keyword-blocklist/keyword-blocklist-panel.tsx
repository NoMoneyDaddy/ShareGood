"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 新增詞條表單：呼叫既有的 POST /api/admin/keyword-blocklist（唯一性、audit log 都在
// 那支 API 裡），這裡只負責收欄位跟送出。
export function CreateKeywordForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (keyword.trim().length < 1 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/keyword-blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setKeyword("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "新增失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        maxLength={100}
        placeholder="新增關鍵字（例如：折現）"
        className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      <Button type="submit" variant="brand" disabled={keyword.trim().length < 1 || submitting}>
        {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : "新增"}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

// 單一詞條的停用／重新啟用按鈕：呼叫既有的 PATCH /api/admin/keyword-blocklist/[id]。
export function ToggleKeywordButton({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/keyword-blocklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? (
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        ) : isActive ? (
          "停用"
        ) : (
          "重新啟用"
        )}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
