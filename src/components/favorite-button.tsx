"use client";

import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

// 收藏按鈕（docs/plan/m12-product-growth.md 交付內容 2）：比照 share-link-button.tsx 的
// 獨立元件慣例，一顆按鈕同時做收藏／取消收藏。樂觀更新畫面（先切換圖示再打 API），
// API 本身冪等（POST/DELETE 皆回 200），失敗時退回原本狀態並顯示簡短錯誤。
export function FavoriteButton({
  itemId,
  initialFavorited,
  className,
}: {
  itemId: string;
  initialFavorited: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !favorited;
    setFavorited(next);
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/items/${itemId}/favorites`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        setFavorited(!next);
        setError(true);
      } else {
        // 讓頁面上的「已有 N 人收藏」社會證明數字（server component 查出來的）跟著更新。
        router.refresh();
      }
    } catch {
      setFavorited(!next);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? "取消收藏" : "收藏這個物品"}
      title={error ? "操作失敗，請再試一次" : undefined}
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
        favorited
          ? "border-brand/30 bg-brand-soft text-brand-ink hover:bg-brand-soft/70"
          : "border-line text-ink-soft hover:bg-paper-2 hover:text-ink",
        className,
      )}
    >
      <Heart
        size={15}
        strokeWidth={2.2}
        aria-hidden="true"
        className={cn(favorited && "fill-current")}
      />
      {favorited ? "已收藏" : "收藏"}
    </button>
  );
}
