import Link from "next/link";
import { Compass, Heart, MessageCircle, Plus, User } from "lucide-react";

// 行動版底部導覽（使用者指定必備）。M1 前，逛好物以外的分頁先以停用態呈現。
export function BottomTab() {
  const inactive =
    "flex flex-col items-center gap-1 py-1 text-ink-soft/50 cursor-default";

  return (
    <nav
      aria-label="主選單"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pb-2 pt-1.5 text-[11px]">
        <Link
          href="/"
          className="flex flex-col items-center gap-1 py-1 font-semibold text-brand"
        >
          <Compass size={20} strokeWidth={2} />
          逛好物
        </Link>
        <span className={inactive} title="即將開放">
          <Heart size={20} strokeWidth={2} />
          我的需要
        </span>
        <span className="flex flex-col items-center gap-1" title="即將開放">
          <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_-6px_oklch(0.64_0.16_45_/_0.55)]">
            <Plus size={22} strokeWidth={2.4} />
          </span>
          <span className="text-ink-soft/50">分享</span>
        </span>
        <span className={inactive} title="即將開放">
          <MessageCircle size={20} strokeWidth={2} />
          訊息
        </span>
        <span className={inactive} title="即將開放">
          <User size={20} strokeWidth={2} />
          我的
        </span>
      </div>
    </nav>
  );
}
