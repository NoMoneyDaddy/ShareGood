import type { LucideIcon } from "lucide-react";
import { Compass, Heart, LayoutGrid, MessageCircle, Plus, User } from "lucide-react";
import Link from "next/link";

// 行動版底部導覽（使用者指定必備）。M1 前，逛好物以外的分頁先以停用態呈現。
// 停用分頁一律用原生 disabled <button>（而非 span+title）：disabled 語意會被輔助
// 科技辨識，title 提示不可靠（觸控裝置無 hover、部分螢幕閱讀器不朗讀）。
//
// 「探索」分頁（master-plan §6 第 2 項「列表」補上 /items 瀏覽頁時新增）：「我的需要」
// 這個既有停用分頁依 docs/plan/original-master-plan-v1.md §「我的需要」的原意對應
// `/me/claims`（留言／抽籤／直贈／交接紀錄），語意是「我參與過的接手活動」，不是「瀏覽
// 好物列表」，兩者不是同一件事，所以不能把它直接接到 /items；那個功能本身還沒有對應頁面，
// 繼續維持停用。改為新增一個獨立的「探索」分頁接 /items（縣市/分類/關鍵字篩選＋排序），
// 圖示故意用 LayoutGrid（而非 Compass）避免跟「逛好物」（首頁）視覺上混淆。
export function BottomTab() {
  return (
    <nav
      aria-label="主選單"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-6 items-end px-2 pb-2 pt-1.5 text-[11px]">
        <Link
          href="/"
          className="flex flex-col items-center gap-1 py-1 font-semibold text-brand focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Compass size={20} strokeWidth={2} aria-hidden="true" />
          逛好物
        </Link>
        <Link
          href="/items"
          className="flex flex-col items-center gap-1 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LayoutGrid size={20} strokeWidth={2} aria-hidden="true" />
          探索
        </Link>
        <DisabledTab icon={Heart} label="我的需要" />
        <Link
          href="/items/new"
          className="flex flex-col items-center gap-1 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* 未登入／未完成 onboarding 的使用者點進 /items/new 會被導去對應頁面，
              不在這裡重複判斷登入狀態（BottomTab 是全站共用元件，不吃 session）。 */}
          <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-brand-glow">
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
        <DisabledTab icon={User} label="我的" />
      </div>
    </nav>
  );
}

function DisabledTab({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      disabled
      aria-label={`${label}（即將開放）`}
      className="flex flex-col items-center gap-1 border-0 bg-transparent py-1 text-ink-disabled disabled:cursor-not-allowed"
    >
      <Icon size={20} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}
