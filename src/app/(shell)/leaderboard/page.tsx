import { Crown, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { UserBadges } from "@/components/user-badge";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "貢獻排行榜｜好物共享" };

// 公開頁不需要登入即可查看，內容 5 分鐘內不太會變化，用 ISR 快取減少資料庫負擔
// （這支頁面不呼叫 auth()／cookies()／searchParams，符合 Next.js 靜態渲染條件，
// revalidate 才有實際效果）。
export const revalidate = 300;

const LEADERBOARD_SIZE = 50;
// 排行榜要濾掉貢獻值 ≤0 與已去識別化帳號（M7 帳號刪除去識別化，見 src/lib/
// account-deletion.ts：User.deletedAt 非 null 代表已去識別化），濾完之後才截斷到 50 名，
// 所以 groupBy 階段要多撈一些當緩衝，避免榜單前段剛好卡到已刪除帳號而湊不滿 50 名。
// 4 倍緩衝在目前平台規模已足夠寬裕，且仍是有界查詢（不是無上限撈全表）。
const GROUP_BY_FETCH_SIZE = LEADERBOARD_SIZE * 4;

type LeaderboardRow = {
  userId: string;
  nickname: string;
  points: number;
  roles: string[];
};

async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const grouped = await db.contributionEvent.groupBy({
    by: ["userId"],
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: GROUP_BY_FETCH_SIZE,
  });

  const candidates = grouped
    .map((g) => ({ userId: g.userId, points: g._sum.points ?? 0 }))
    .filter((g) => g.points > 0);
  if (candidates.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: candidates.map((c) => c.userId) }, deletedAt: null },
    include: { profile: { select: { nickname: true } }, roles: { select: { role: true } } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: LeaderboardRow[] = [];
  for (const c of candidates) {
    const user = userById.get(c.userId);
    // 沒有 profile 理論上不會發生（onboarding 必建），已去識別化帳號也不會出現在
    // userById（上面查詢已加 deletedAt: null 條件），這裡再擋一次純防呆。
    if (!user?.profile) continue;
    rows.push({
      userId: c.userId,
      nickname: user.profile.nickname,
      points: c.points,
      roles: user.roles.map((r) => r.role),
    });
    if (rows.length >= LEADERBOARD_SIZE) break;
  }
  return rows;
}

const RANK_MEDAL_STYLE: Record<number, string> = {
  1: "bg-brand-accent text-white",
  2: "bg-paper-2 text-ink border border-line",
  3: "bg-brand-soft text-brand-ink",
};

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <Trophy size={22} strokeWidth={2} aria-hidden="true" className="text-brand-accent-ink" />
        <h1 className="text-2xl font-bold tracking-tight">貢獻排行榜</h1>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        分享完成 +10、接手完成 +2，累計貢獻值最高的前 50
        位好鄰居都在這裡。貢獻值只用來表揚熱心分享，不能拿來兌換或交易任何東西。
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="排行榜還在等第一位上榜者"
          description="完成一次分享或接手，就有機會成為榜上第一人。"
          action={{ href: "/items/new", label: "上架第一件好物" }}
        />
      ) : (
        <>
          <ol className="mt-6 flex flex-col gap-3">
            {top3.map((row, i) => {
              const rank = i + 1;
              return (
                <li
                  key={row.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border border-line bg-card p-4",
                    rank === 1 && "border-brand-accent/50 shadow-sm",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-extrabold",
                      RANK_MEDAL_STYLE[rank],
                    )}
                    aria-hidden="true"
                  >
                    {rank === 1 ? <Crown size={20} strokeWidth={2.2} /> : rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <Link
                        href={`/u/${row.userId}`}
                        className="truncate font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {row.nickname}
                      </Link>
                      <UserBadges roles={row.roles} points={row.points} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xl font-bold tracking-tight text-brand-ink">
                    {row.points}
                  </span>
                </li>
              );
            })}
          </ol>

          {rest.length > 0 && (
            <ol className="mt-4 divide-y divide-line rounded-2xl border border-line bg-card">
              {rest.map((row, i) => {
                const rank = i + 4;
                return (
                  <li key={row.userId} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-6 shrink-0 text-center text-sm font-semibold text-ink-soft">
                      {rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <Link
                          href={`/u/${row.userId}`}
                          className="truncate text-sm font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {row.nickname}
                        </Link>
                        <UserBadges roles={row.roles} points={row.points} />
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-ink">{row.points}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
