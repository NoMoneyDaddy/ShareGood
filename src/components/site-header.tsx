import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";

export async function SiteHeader() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

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
                <Button asChild size="sm" className="bg-brand text-white hover:bg-brand-ink">
                  <Link href="/onboarding">完成設定</Link>
                </Button>
              )}
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <Button type="submit" variant="outline" size="sm">
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
              <Button type="submit" size="sm" className="bg-brand text-white hover:bg-brand-ink">
                登入
              </Button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
