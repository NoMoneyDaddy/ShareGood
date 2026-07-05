import Link from "next/link";
import type { Session } from "next-auth";
import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/generated/prisma/client";

type SiteHeaderProps = {
  session: Session | null;
  profile: Profile | null;
};

// session/profile 由呼叫端（HomePage）一次查好往下傳，避免和頁面主體重複查同一筆資料。
export function SiteHeader({ session, profile }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display text-xl font-extrabold tracking-tight text-ink">
            好物共享
          </span>
          <span className="hidden text-sm font-medium text-ink-soft sm:inline">ShareGood</span>
        </Link>

        <nav className="flex items-center gap-2.5">
          {session?.user ? (
            <>
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
