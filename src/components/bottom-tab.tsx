import { Home, LayoutGrid, MessageCircle, Plus, User } from "lucide-react";
import Link from "next/link";

// 行動版底部導覽（使用者指定必備）。
//
// M11 改版（使用者實測回饋第 2 項）：原本 6 格裡有兩個停用態佔位分頁（「我的需要」
// 「我的」，M1 前的暫時安排，見 git 歷史），加上「逛好物」（首頁）與「探索」
// （/items）語意重疊，使用者實測時分不清兩者差異、也點不動停用分頁——這裡整組
// 換成使用者拍板的 5 格設計，全部可點，不留任何 disabled 佔位：
//   首頁 `/`｜逛好物 `/items`｜分享 `/items/new`（中央主行動）｜訊息 `/conversations`｜
//   我的 `/me`。
// 原本停用的「我的需要」概念併入 `/me/subscriptions`（訂閱通知，見 /me 中心頁），
// 不再保留獨立分頁；「我的」現在指向新的 `/me` 中心頁（本次新增），不再是空按鈕。
export function BottomTab() {
  return (
    <nav
      aria-label="主選單"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pb-2 pt-1.5 text-[11px]">
        <Link
          href="/"
          className="flex flex-col items-center gap-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Home size={20} strokeWidth={2} aria-hidden="true" />
          首頁
        </Link>
        <Link
          href="/items"
          className="flex flex-col items-center gap-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LayoutGrid size={20} strokeWidth={2} aria-hidden="true" />
          逛好物
        </Link>
        <Link
          href="/items/new"
          className="flex flex-col items-center gap-1 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* 未登入／未完成 onboarding 的使用者點進 /items/new 會被導去對應頁面，
              不在這裡重複判斷登入狀態（BottomTab 是全站共用元件，不吃 session）。 */}
          <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-brand-glow">
            <Plus size={22} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="font-semibold text-ink">分享</span>
        </Link>
        <Link
          href="/conversations"
          className="flex flex-col items-center gap-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageCircle size={20} strokeWidth={2} aria-hidden="true" />
          訊息
        </Link>
        <Link
          href="/me"
          className="flex flex-col items-center gap-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <User size={20} strokeWidth={2} aria-hidden="true" />
          我的
        </Link>
      </div>
    </nav>
  );
}
