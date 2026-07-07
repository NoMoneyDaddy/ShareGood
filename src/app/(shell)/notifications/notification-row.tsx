"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NotificationRowProps = {
  id: string;
  href: string;
  initialReadAt: string | null;
  message: string;
  timeLabel: string;
};

// 點擊通知：導去對應物品詳情頁的同時，順便打已讀 API（不等待回應，樂觀更新畫面）。
export function NotificationRow({
  id,
  href,
  initialReadAt,
  message,
  timeLabel,
}: NotificationRowProps) {
  const [readAt, setReadAt] = useState(initialReadAt);
  const isUnread = !readAt;

  function handleClick() {
    if (!readAt) {
      setReadAt(new Date().toISOString());
      fetch(`/api/notifications/${id}/read`, { method: "PATCH" }).catch(() => {
        // 樂觀更新失敗就算了，不影響導頁；下次重新整理通知列表會再看到正確狀態。
      });
    }
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50",
        isUnread
          ? "border-brand/30 bg-brand-soft/40 hover:bg-brand-soft/60"
          : "border-line bg-card hover:bg-paper-2",
      )}
    >
      {isUnread && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", isUnread ? "font-semibold text-ink" : "text-ink-soft")}>
          {message}
        </p>
        <span className="mt-1 block text-xs text-ink-soft">{timeLabel}</span>
      </div>
    </Link>
  );
}
