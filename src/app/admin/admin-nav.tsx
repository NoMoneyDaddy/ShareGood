import Link from "next/link";
import { cn } from "@/lib/utils";

const ADMIN_NAV_LINKS = [
  { href: "/admin", label: "總覽" },
  { href: "/admin/reports", label: "檢舉" },
  { href: "/admin/appeals", label: "申訴" },
  { href: "/admin/support-tickets", label: "使用者回報" },
  { href: "/admin/items", label: "物品管理" },
  { href: "/admin/users", label: "使用者管理" },
  { href: "/admin/audit-logs", label: "稽核紀錄" },
] as const;

// 後台各頁共用的頂部導覽（master-plan §7 第 7 項「後台最小集」）：避免每個 /admin/* 子頁
// 各自變成孤兒頁——進到任何一頁都能一鍵切換到其他治理功能，不用每次手動改網址。
// `current` 由呼叫端明確傳入（比對 pathname 前綴），不在這裡用 usePathname，讓這個元件
// 保持 server component、不用整包變成 client bundle。
export function AdminNav({ current }: { current: string }) {
  return (
    <nav aria-label="後台導覽" className="flex flex-wrap gap-2 border-b border-line pb-4">
      {ADMIN_NAV_LINKS.map((link) => {
        const isCurrent =
          link.href === "/admin" ? current === "/admin" : current.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              isCurrent
                ? "border-brand bg-brand/10 font-medium text-brand-ink"
                : "border-line text-ink-soft hover:bg-paper-2",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
