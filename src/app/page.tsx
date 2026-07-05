import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <section>
        <h1 className="text-4xl font-bold tracking-tight">ShareGood 好物共享</h1>
        <p className="text-muted-foreground mt-4 text-lg">
          把用不到但還能用的好物分享出去，讓剛好需要的人接手。
          免費共享，不買賣、不交換，最細到縣市。
        </p>
      </section>

      <section className="mt-10">
        {session?.user ? (
          <div className="space-y-4">
            <p>
              你好，<strong>{profile?.nickname ?? session.user.name ?? "朋友"}</strong>
              {profile ? null : (
                <>
                  ——還差一步，
                  <Link href="/onboarding" className="underline">
                    設定暱稱與縣市
                  </Link>
                  就能開始使用。
                </>
              )}
            </p>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <Button variant="outline" type="submit">
                登出
              </Button>
            </form>
          </div>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" size="lg">
              使用 Google 登入，開始共享
            </Button>
          </form>
        )}
      </section>

      <section className="mt-16 grid gap-6 sm:grid-cols-3">
        <div>
          <h2 className="font-semibold">1. 分享</h2>
          <p className="text-muted-foreground text-sm">拍照上架用不到的好物，選擇你的縣市。</p>
        </div>
        <div>
          <h2 className="font-semibold">2. 留言需要</h2>
          <p className="text-muted-foreground text-sm">需要的人留言，分享者挑選接手的人。</p>
        </div>
        <div>
          <h2 className="font-semibold">3. 交接完成</h2>
          <p className="text-muted-foreground text-sm">私訊約定交接，完成後互相感謝。</p>
        </div>
      </section>
    </main>
  );
}
