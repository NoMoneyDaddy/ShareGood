import { Bell } from "lucide-react";
import Link from "next/link";
import type { Session } from "next-auth";
import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type SiteHeaderProps = {
  session: Session | null;
  profile: Profile | null;
};

// session/profile 由呼叫端（HomePage）一次查好往下傳，避免和頁面主體重複查同一筆資料。
// 未讀通知數則在這裡自己查（輕量 count，不影響呼叫端既有查詢），避免每個用到 SiteHeader
// 的頁面都要多傳一個 prop。
export async function SiteHeader({ session, profile }: SiteHeaderProps) {
  const unreadCount = session?.user
    ? await db.notification.count({ where: { userId: session.user.id, readAt: null } })
    : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display text-xl font-extrabold tracking-tight text-ink">
            好物共享
          </span>
          <span className="text-sm font-medium text-ink-soft">ShareGood</span>
        </Link>

        <nav className="flex items-center gap-2.5">
          {session?.user ? (
            <>
              <Link
                href="/notifications"
                aria-label={unreadCount > 0 ? `通知，${unreadCount} 則未讀` : "通知"}
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-2 hover:text-ink focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Bell size={19} strokeWidth={2} aria-hidden="true" />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-white"
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
