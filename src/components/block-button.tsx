"use client";

import { Ban, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// 封鎖使用者按鈕（docs/plan/m12-product-growth.md 交付內容 3）：比照 report-button.tsx
// 慣例，預設顯示一顆小小的文字按鈕，點下去要求二次確認才真的送出（封鎖比檢舉影響更直接
// ——會立刻擋掉雙方之後的留言/直贈互動——二次確認避免誤觸）。這支按鈕只出現在「封鎖發起人」
// 眼前，對「被封鎖方」完全無感知（他們不會在任何地方看到自己被誰封鎖過，見規格核心決策點）。
export function BlockButton({
  targetUserId,
  initialBlocked = false,
  className,
}: {
  targetUserId: string;
  initialBlocked?: boolean;
  className?: string;
}) {
  const [blocked, setBlocked] = useState(initialBlocked);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${targetUserId}/block`, {
        method: blocked ? "DELETE" : "POST",
      });
      if (res.ok) {
        setBlocked(!blocked);
        setConfirming(false);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  if (blocked) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-ink-soft transition hover:text-ink disabled:opacity-60",
          className,
        )}
      >
        {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
        已封鎖・解除封鎖
      </button>
    );
  }

  if (confirming) {
    return (
      <span className={cn("inline-flex items-center gap-2 text-xs", className)}>
        <span className="text-ink-soft">確定要封鎖這位使用者？</span>
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className="font-semibold text-destructive hover:underline disabled:opacity-60"
        >
          {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : "確定封鎖"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="text-ink-soft hover:underline"
        >
          取消
        </button>
        {error && <span className="text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-ink-soft transition hover:text-destructive",
        className,
      )}
    >
      <Ban size={12} aria-hidden="true" />
      封鎖這位使用者
    </button>
  );
}
