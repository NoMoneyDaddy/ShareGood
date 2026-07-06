import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// generateMetadata 與頁面本體都要查 profile；db.profile.findUnique 不是 fetch()，
// Next.js 不會自動去重，用 React cache() 讓同一次請求內兩處呼叫共用一次查詢結果。
const getProfile = cache(async (userId: string) => {
  return db.profile.findUnique({ where: { userId } });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  const profile = await getProfile(userId);
  if (!profile) return {};
  return { title: `${profile.nickname} 的分享足跡｜好物共享` };
}

// 公開個人頁：不需要登入就能看，顯示暱稱與累計貢獻值（master-plan「感謝與貢獻值」）。
export default async function UserProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const profile = await getProfile(userId);
  if (!profile) notFound();

  const [session, contributionSum] = await Promise.all([
    auth(),
    db.contributionEvent.aggregate({ where: { userId }, _sum: { points: true } }),
  ]);

  const viewerProfile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  // 累計貢獻值就是真實反映使用者行為的數字，no_show 扣分可能讓它變負數，不特別防呆。
  const totalPoints = contributionSum._sum.points ?? 0;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={viewerProfile} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{profile.nickname}</h1>
        <p className="mt-1 text-sm text-ink-soft">分享足跡</p>

        <div className="mt-6 rounded-xl border border-line bg-card p-4">
          <p className="text-sm text-ink-soft">累計貢獻值</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-brand-ink">{totalPoints}</p>
        </div>

        {session?.user?.id === userId && (
          <Link
            href="/me/wallet"
            className="mt-4 flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3.5 text-sm font-medium text-ink transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            優惠券錢包
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </main>
    </div>
  );
}
