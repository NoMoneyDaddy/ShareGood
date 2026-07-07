import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { DealReviewRow } from "./deal-review-row";

export const metadata = { title: "好康審核佇列" };

const PAGE_SIZE = 20;

// /admin/deal-reviews（master-plan §9a 交付內容 2）：DealInfo 審核佇列最小集。moderator/
// admin 限定，其餘一律 404。比照 /admin/support-tickets 既有慣例：伺服器元件直接查 db
// 列出 pending_review 的 DealInfo（只有 REQUIRE_REVIEW flag 開啟時使用者投稿才會進到
// 這裡；flag 關閉時投稿直接 published，這個佇列自然是空的），核准/駁回動作交給
// deal-review-row.tsx 呼叫既有 PATCH /api/deal-infos/[id]。
export default async function AdminDealReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const { cursor } = await searchParams;

  const dealInfos = await db.dealInfo.findMany({
    where: { status: DealInfoStatus.pending_review },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      summary: true,
      sourceUrl: true,
      isNationwide: true,
      expiresAt: true,
      createdAt: true,
      submitter: { select: { id: true, profile: { select: { nickname: true } } } },
      cities: { select: { city: { select: { name: true } } } },
    },
  });
  const hasMore = dealInfos.length > PAGE_SIZE;
  const page = hasMore ? dealInfos.slice(0, PAGE_SIZE) : dealInfos;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">好康審核佇列</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        先審後上模式（系統設定 REQUIRE_REVIEW）開啟時，使用者投稿的好康資訊會先進到這裡等待審核。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/deal-reviews" />
      </div>

      <div className="mt-6 space-y-3">
        {page.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            目前沒有待審核的好康資訊
          </p>
        ) : (
          page.map((dealInfo) => (
            <DealReviewRow
              key={dealInfo.id}
              dealInfo={{
                id: dealInfo.id,
                title: dealInfo.title,
                summary: dealInfo.summary,
                sourceUrl: dealInfo.sourceUrl,
                cities: dealInfo.isNationwide
                  ? "全台適用"
                  : dealInfo.cities.map((c) => c.city.name).join("、"),
                expiresAt: dealInfo.expiresAt.toISOString(),
                createdAt: dealInfo.createdAt.toISOString(),
                submitterNickname: dealInfo.submitter?.profile?.nickname ?? "好物共享使用者",
              }}
            />
          ))
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/deal-reviews?cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
