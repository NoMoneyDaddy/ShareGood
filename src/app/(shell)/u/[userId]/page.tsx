import type { Metadata } from "next";
import Link from "next/link";
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
  // M7 帳號刪除是「應用層去識別化」而非真刪除：User 列保留、nickname 已被改寫為
  // 「已刪除的使用者」，個人頁仍回 200 顯示匿名化後的頁面與歷史統計（維持其他使用者
  // 看到的歷史紀錄完整性，見 src/lib/account-deletion.ts 與 data-rights.test.ts 的驗收）。
  // 匿名化後已無法連回真人、不算個資洩漏，因此這裡刻意「不」做 deletedAt 過濾——
  // 曾有一版為了隱私改成 deletedAt notFound()，但那會破壞 M7 保留匿名歷史的既定設計，
  // 已撤回；排行榜（主動推薦榜單）才需要排除已刪除帳號，被動查詢的個人頁不需要。
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
  // 貢獻值總分與完成件數用 getUserSharingStats 同一次 groupBy 拿齊（口徑＝contribution_events
  // 事件筆數，與記分一致、天然去重）；「收到感謝」另查 thanksMessage。下方三格統計列的呈現
  // 參考 GiveCircle 個人檔案頁（研究文件 05-givecircle-reference.md）——單一貢獻值數字對陌生
  // 訪客不夠直覺，補三個具體行為次數當信任信號。三者互不相關，與身份組查詢一併平行執行。
  const [stats, roles, thanksCount] = await Promise.all([
    getUserSharingStats(userId),
    db.userRole.findMany({ where: { userId }, select: { role: true } }),
    db.thanksMessage.count({ where: { toUserId: userId } }),
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
        {/* 陌生訪客點進來想確認「這個人可不可信」，看到裸數字無從判斷高低——補一句
            說明貢獻值怎麼來、代表什麼（手機沒有 hover 看不到徽章 tooltip，這裡用文字補上）。 */}
        <p className="mt-2 border-t border-line/70 pt-2 text-xs text-ink-soft">
          分享完成 +10、接手完成 +2 累積而來，只用來表揚熱心分享。
          <Link
            href="/leaderboard"
            className="ml-1 text-brand-ink underline-offset-2 hover:underline"
          >
            看排行榜
          </Link>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-card">
        <div className="px-3 py-4 text-center">
          <p className="text-xl font-bold tracking-tight text-ink">{stats.sharedCount}</p>
          <p className="mt-0.5 text-xs text-ink-soft">完成分享</p>
        </div>
        <div className="px-3 py-4 text-center">
          <p className="text-xl font-bold tracking-tight text-ink">{stats.receivedCount}</p>
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
