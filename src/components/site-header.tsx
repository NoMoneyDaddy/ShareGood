import { Bell } from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";
import { signIn, signOut } from "@/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type SiteHeaderProps = {
  session: Session | null;
  profile: Profile | null;
};

// session/profile 由呼叫端（HomePage）一次查好往下傳，避免和頁面主體重複查同一筆資料。
// 未讀通知數與是否為 moderator/admin 則在這裡自己查（輕量查詢，不影響呼叫端既有查詢），
// 避免每個用到 SiteHeader 的頁面都要多傳一個 prop。
export async function SiteHeader({ session, profile }: SiteHeaderProps) {
  const [unreadCount, moderationRoleCount] = session?.user
    ? await Promise.all([
        db.notification.count({ where: { userId: session.user.id, readAt: null } }),
        db.userRole.count({
          where: { userId: session.user.id, role: { in: ["moderator", "admin"] } },
        }),
      ])
    : [0, 0];
  const canModerate = moderationRoleCount > 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* M11：中英文標題字級調和（使用者實測回饋第 6 項：「標題中英文字級不一致觀感
            突兀」）。原本「好物共享」用 text-xl font-extrabold、「ShareGood」用 text-sm
            font-medium 水平並排，兩者字重與字級差距過大導致視覺上像兩個不相關的標籤而非
            一體品牌。改成直式雙行 lockup：中文維持主視覺份量（略降一階到 text-lg 讓兩行
            整體高度貼近原本單行高度，避免 header 變高），英文改成大寫、加寬字距、用品牌色
            （靛青）當作中文的輔助說明而非平行的第二個標題，兩行共用同一個 leading-none
            垂直節奏，讀起來是一體的 lockup 而不是兩個字級衝突的元素。 */}
        <Link href="/" className="flex flex-col leading-none">
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">
            好物共享
          </span>
          <span className="mt-1 text-[11px] font-semibold tracking-[0.2em] text-brand-ink">
            SHAREGOOD
          </span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2.5">
          <ThemeToggle />
          {session?.user ? (
            <>
              {canModerate && (
                <Link
                  href="/admin"
                  className="hidden text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline sm:inline"
                >
                  後台管理
                </Link>
              )}
              <Link
                href="/notifications"
                aria-label={unreadCount > 0 ? `通知，${unreadCount} 則未讀` : "通知"}
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Bell size={19} strokeWidth={2} aria-hidden="true" />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-brand-foreground"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <span className="hidden text-sm text-ink-soft md:inline">
                {profile?.nickname ?? session.user.name ?? "朋友"}
              </span>
              {!profile && (
                <Button asChild variant="brand" size="xl">
                  <Link href="/onboarding">完成設定</Link>
                </Button>
              )}
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <Button type="submit" variant="outline" size="xl">
                  登出
                </Button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google");
              }}
            >
              <Button type="submit" variant="brand" size="xl">
                登入
              </Button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
