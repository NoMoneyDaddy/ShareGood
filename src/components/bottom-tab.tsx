import type { LucideIcon } from "lucide-react";
import { Compass, Heart, MessageCircle, Plus, User } from "lucide-react";
import Link from "next/link";

// 行動版底部導覽（使用者指定必備）。M1 前，逛好物以外的分頁先以停用態呈現。
// 停用分頁一律用原生 disabled <button>（而非 span+title）：disabled 語意會被輔助
// 科技辨識，title 提示不可靠（觸控裝置無 hover、部分螢幕閱讀器不朗讀）。
export function BottomTab() {
  return (
    <nav
      aria-label="主選單"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pb-2 pt-1.5 text-[11px]">
        <Link href="/" className="flex flex-col items-center gap-1 py-1 font-semibold text-brand">
          <Compass size={20} strokeWidth={2} />
          逛好物
        </Link>
        <DisabledTab icon={Heart} label="我的需要" />
        <button
          type="button"
          disabled
          aria-label="分享（即將開放）"
          className="flex flex-col items-center gap-1 border-0 bg-transparent p-0 disabled:cursor-not-allowed"
        >
          {/* 停用態不用品牌色發光樣式：避免看起來像可點的主要 CTA，實際上點了沒反應 */}
          <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-paper-2 text-ink-disabled">
            <Plus size={22} strokeWidth={2.4} />
          </span>
          <span className="text-ink-disabled">分享</span>
        </button>
        <DisabledTab icon={MessageCircle} label="訊息" />
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
      <Icon size={20} strokeWidth={2} />
      {label}
    </button>
  );
}
