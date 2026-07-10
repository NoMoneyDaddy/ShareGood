import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/ops", label: "總覽" },
  { href: "/admin/ops/storage", label: "儲存空間" },
  { href: "/admin/ops/performance", label: "慢查詢" },
  { href: "/admin/ops/notifications", label: "通知" },
] as const;

// `/admin/ops` 四個分頁共用的頁籤導覽（master-plan §8a 交付內容 7）。
export function OpsNav({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="mt-6 flex flex-wrap gap-2" aria-label="營運後台分頁">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            active === tab.href
              ? "border-brand bg-brand/10 font-medium text-brand-ink"
              : "border-line text-ink-soft hover:bg-paper-2",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
