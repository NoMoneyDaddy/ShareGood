"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// 封鎖名單單列：解除封鎖成功後用 router.refresh() 讓清單重新查一次（這一列自然消失），
// 比照專案既有 client component 慣例（handover-section.tsx 等）不做本地樂觀移除清單。
export function BlockedUserRow({ blockedId, nickname }: { blockedId: string; nickname: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function unblock() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${blockedId}/block`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setError("操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4">
      <span className="font-medium text-ink">{nickname}</span>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={unblock}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-60"
        >
          {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          解除封鎖
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
