import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BackBar } from "@/components/back-bar";
import { UserBadges } from "@/components/user-badge";
import { getUserSharingStats } from "@/lib/contribution";
import { db } from "@/lib/db";

// 加入時間（信任訊號）：只顯示到「年／月」粒度（台北時區），不洩漏更精確的註冊時間點。
function formatJoinedMonth(date: Date): string {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year} 年 ${month} 月加入`;
}

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

  // session/viewerProfile 給 SiteHeader 用的查詢已收斂進 (shell)/layout.tsx，這裡不用再查一次。
  // 貢獻值總分與完成件數同一次 groupBy 拿齊（見 getUserSharingStats 口徑說明），
  // 跟身份組查詢平行執行，不串行疊加延遲。
  const [stats, roles] = await Promise.all([
    getUserSharingStats(userId),
    db.userRole.findMany({ where: { userId }, select: { role: true } }),
  ]);

  // 累計貢獻值就是真實反映使用者行為的數字，no_show 扣分可能讓它變負數，不特別防呆。
  const totalPoints = stats.totalPoints;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <BackBar fallbackHref="/" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{profile.nickname}</h1>
        <UserBadges roles={roles} points={totalPoints} size="md" />
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        分享足跡<span className="mx-1.5">・</span>
        {formatJoinedMonth(profile.createdAt)}
      </p>

      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-ink-soft">累計貢獻值</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-brand-ink">{totalPoints}</p>
        <p className="mt-2 border-t border-line/70 pt-2 text-sm text-ink-soft">
          已完成分享 {stats.sharedCount} 件<span className="mx-1.5">・</span>已接手{" "}
          {stats.receivedCount} 件
        </p>
      </div>
    </div>
  );
}
