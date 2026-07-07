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
  // M8 營運強化（master-plan §8a）／M7 資料權利與法務（master-plan §7a）：這四個子頁一直
  // 存在（各自有自己的權限檢查），只是沒有被這份共用導覽收錄，變成「網址存在但沒有入口
  // 點得到」的孤兒頁；/admin/legal-holds 是 admin-only、/admin/legal-requests 不對外開放，
  // 但比照既有 /admin/appeals 的處理方式——moderator 點進去 404 也可以接受，這裡不依角色
  // 過濾連結本身（見各頁自己的權限判斷）。
  { href: "/admin/ops", label: "營運儀表板" },
  { href: "/admin/data", label: "資料管理" },
  { href: "/admin/legal-holds", label: "訴訟保全" },
  { href: "/admin/legal-requests", label: "調閱請求" },
  // M9（master-plan §9a 交付內容 3）：keyword_blocklist 表從 M2 就存在，一直沒有管理頁。
  { href: "/admin/keyword-blocklist", label: "關鍵字黑名單" },
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
