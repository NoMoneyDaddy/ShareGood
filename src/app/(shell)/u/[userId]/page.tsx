import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
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

  // session/viewerProfile 給 SiteHeader 用的查詢已收斂進 (shell)/layout.tsx，這裡不用再查一次。
  // 參考 GiveCircle 個人檔案頁的統計列（研究文件 05-givecircle-reference.md：「年度分享／
  // 年度公益／感謝率」）——公開個人頁只有一個累計貢獻值數字，對第一次點進來的陌生訪客
  // 不夠直覺（不知道這個數字代表什麼）。這裡補上三個具體行為次數當信任信號，
  // 三個查詢互不相關可以併發。
  const [contributionSum, sharedCount, receivedCount, thanksCount] = await Promise.all([
    db.contributionEvent.aggregate({ where: { userId }, _sum: { points: true } }),
    db.item.count({ where: { ownerId: userId, status: "completed" } }),
    db.handoverRecord.count({ where: { receiverId: userId, status: "completed" } }),
    db.thanksMessage.count({ where: { toUserId: userId } }),
  ]);

  // 累計貢獻值就是真實反映使用者行為的數字，no_show 扣分可能讓它變負數，不特別防呆。
  const totalPoints = contributionSum._sum.points ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{profile.nickname}</h1>
      <p className="mt-1 text-sm text-ink-soft">分享足跡</p>

      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-ink-soft">累計貢獻值</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-brand-ink">{totalPoints}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-card">
        <div className="px-3 py-4 text-center">
          <p className="text-xl font-bold tracking-tight text-ink">{sharedCount}</p>
          <p className="mt-0.5 text-xs text-ink-soft">完成分享</p>
        </div>
        <div className="px-3 py-4 text-center">
          <p className="text-xl font-bold tracking-tight text-ink">{receivedCount}</p>
          <p className="mt-0.5 text-xs text-ink-soft">完成接手</p>
        </div>
        <div className="px-3 py-4 text-center">
          <p className="text-xl font-bold tracking-tight text-ink">{thanksCount}</p>
          <p className="mt-0.5 text-xs text-ink-soft">收到感謝</p>
        </div>
      </div>
    </div>
  );
}
