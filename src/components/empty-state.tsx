import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type EmptyStateAction = { href: string; label: string };

// M10 批次 3：conversations/notifications/wallet/subscriptions/support 五個列表頁
// 原本各自只有一行 `<p className="text-ink-soft">` 的空狀態文字，這裡統一成「圖示＋
// 標題＋說明＋（選填）主要行動按鈕」的樣式，不用 Lottie（動效低強度、只用純 SVG／lucide
// icon），純文字排版也算數（action 可省略，見 /support 的用法）。行動按鈕維持 44px
// 觸控目標（比照 Button size="xl" 的高度），跟其餘表單頁一致。
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-line bg-card px-6 py-12 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
        aria-hidden="true"
      >
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="text-sm text-ink-soft">{description}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="mt-2 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-medium text-white transition hover:bg-brand-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
