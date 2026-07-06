import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { ItemStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export const metadata = { title: "優惠券錢包", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

// M3 錢包只關心優惠券還「活著」的這幾個狀態（見 master-plan.md §8）；draft／pending_review
// 尚未公開、removed_by_* 已被下架，都不是使用者會想在錢包裡追蹤的狀態，排除掉。
const RELEVANT_STATUSES = [
  "published",
  "reserved",
  "handover_pending",
  "completed",
  "expired",
] as const satisfies readonly ItemStatus[];

const STATUS_LABELS: Record<(typeof RELEVANT_STATUSES)[number], string> = {
  published: "進行中",
  reserved: "已被認領",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已過期",
};

const STATUS_BADGE_CLASSES: Record<(typeof RELEVANT_STATUSES)[number], string> = {
  published: "bg-brand-soft text-brand-ink",
  reserved: "bg-paper-2 text-ink-soft",
  handover_pending: "bg-paper-2 text-ink-soft",
  completed: "bg-paper-2 text-ink-soft",
  expired: "bg-paper-2 text-ink-soft",
};

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
});

type WalletCoupon = {
  id: string;
  title: string;
  status: ItemStatus;
  expiresAt: Date | null;
  couponDetail: { faceValue: string; merchantName: string } | null;
  // 揭露狀態只對「我接手的券」有意義（見 fetchReceivedCoupons）；「我分享的券」一律 false，
  // CouponCard 不會顯示揭露徽章。券碼揭露 API 在 /api/items/[id]/coupon/reveal
  // （feat/m3-coupon-encryption），這裡只讀 CouponRevealLog 是否已有這位使用者的紀錄，
  // 不呼叫該 API、不碰明文。
  hasSecret: boolean;
  revealedByViewer: boolean;
};

// 分頁查詢結果按 createdAt desc 排序後，同一頁內再依狀態分組顯示（順序見
// RELEVANT_STATUSES）；跨頁時同一狀態可能被拆到下一頁才出現，這是「不要一次撈全部」
// 與「依狀態分類顯示」兩個要求之間刻意接受的取捨，比另外對每個狀態各自分頁簡單很多。
function groupByStatus(items: WalletCoupon[]) {
  const groups = new Map<string, WalletCoupon[]>();
  for (const item of items) {
    const list = groups.get(item.status);
    if (list) {
      list.push(item);
    } else {
      groups.set(item.status, [item]);
    }
  }
  return RELEVANT_STATUSES.filter((status) => groups.has(status)).map((status) => ({
    status,
    items: groups.get(status) ?? [],
  }));
}

async function fetchSharedCoupons(userId: string, cursor: string | undefined) {
  const rows = await db.item.findMany({
    where: {
      ownerId: userId,
      couponDetail: { isNot: null },
      status: { in: [...RELEVANT_STATUSES] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      expiresAt: true,
      couponDetail: { select: { faceValue: true, merchantName: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const rowsInPage = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? rowsInPage[rowsInPage.length - 1].id : null;
  const items: WalletCoupon[] = rowsInPage.map((row) => ({
    ...row,
    hasSecret: false,
    revealedByViewer: false,
  }));
  return { items, nextCursor };
}

// 「我接手的券」的接手者身分判定，比照 items/[id]/page.tsx 與 handover/ensure route 的既有
// 邏輯：reserved 狀態下接手者資訊還只存在 accepted 的 ClaimComment／DirectShare 裡（懶建立
// 模式，HandoverRecord 尚未建立）；一旦進入 handover_pending／completed，HandoverRecord.
// receiverId 才是權威來源。用 OR 涵蓋三種來源，同一物品同時只會符合其中一種，不會重複。
async function fetchReceivedCoupons(userId: string, cursor: string | undefined) {
  const rows = await db.item.findMany({
    where: {
      couponDetail: { isNot: null },
      status: { in: [...RELEVANT_STATUSES] },
      OR: [
        { handoverRecord: { receiverId: userId } },
        { claimComments: { some: { userId, status: "accepted" } } },
        { directShares: { some: { receiverId: userId, status: "accepted" } } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      expiresAt: true,
      couponDetail: {
        select: {
          faceValue: true,
          merchantName: true,
          secret: {
            select: {
              // take: 1 只是要判斷「這位使用者是否揭露過」，不是要撈全部紀錄；真的揭露
              // 次數稽核用途看 coupon_reveal_logs 本身，錢包頁不需要。
              revealLogs: { where: { revealedBy: userId }, take: 1, select: { id: true } },
            },
          },
        },
      },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const rowsInPage = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? rowsInPage[rowsInPage.length - 1].id : null;
  const items: WalletCoupon[] = rowsInPage.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    expiresAt: row.expiresAt,
    couponDetail: row.couponDetail
      ? { faceValue: row.couponDetail.faceValue, merchantName: row.couponDetail.merchantName }
      : null,
    hasSecret: row.couponDetail?.secret != null,
    revealedByViewer: (row.couponDetail?.secret?.revealLogs.length ?? 0) > 0,
  }));
  return { items, nextCursor };
}

// 只有交接已確定（handover_pending／completed）時，接手者才可能已經呼叫過揭露 API
// （比照 /api/items/[id]/coupon/reveal 的權限判斷，見 feat/m3-coupon-encryption）；
// published/reserved 階段揭露一定還沒發生，不需要顯示徽章去混淆使用者。
const REVEALABLE_STATUSES: readonly ItemStatus[] = ["handover_pending", "completed"];

function CouponCard({
  coupon,
  showRevealStatus,
}: {
  coupon: WalletCoupon;
  showRevealStatus: boolean;
}) {
  return (
    <li>
      <Link
        href={`/items/${coupon.id}`}
        className="flex flex-col gap-1.5 rounded-xl border border-line bg-card px-4 py-3.5 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{coupon.title}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[coupon.status as (typeof RELEVANT_STATUSES)[number]]}`}
          >
            {STATUS_LABELS[coupon.status as (typeof RELEVANT_STATUSES)[number]]}
          </span>
        </div>
        {coupon.couponDetail && (
          <p className="text-sm text-ink-soft">
            {coupon.couponDetail.faceValue}・{coupon.couponDetail.merchantName}
          </p>
        )}
        {coupon.expiresAt && (
          <p className="text-xs text-ink-soft">
            到期日：{TAIPEI_DATE_FORMATTER.format(coupon.expiresAt)}
          </p>
        )}
        {showRevealStatus && coupon.hasSecret && REVEALABLE_STATUSES.includes(coupon.status) && (
          <p
            className={`text-xs font-medium ${coupon.revealedByViewer ? "text-ink-soft" : "text-brand-ink"}`}
          >
            {coupon.revealedByViewer ? "券碼已查看過" : "券碼尚未查看，點進去查看"}
          </p>
        )}
      </Link>
    </li>
  );
}

function CouponSection({
  title,
  emptyText,
  data,
  cursorParam,
  otherCursorParam,
  otherCursor,
  showRevealStatus,
}: {
  title: string;
  emptyText: string;
  data: { items: WalletCoupon[]; nextCursor: string | null };
  cursorParam: string;
  otherCursorParam: string;
  otherCursor: string | undefined;
  showRevealStatus: boolean;
}) {
  const grouped = groupByStatus(data.items);

  const nextHref = (() => {
    if (!data.nextCursor) return null;
    const qs = new URLSearchParams();
    qs.set(cursorParam, data.nextCursor);
    if (otherCursor) qs.set(otherCursorParam, otherCursor);
    return `/me/wallet?${qs.toString()}`;
  })();

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>

      {data.items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">{emptyText}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {grouped.map(({ status, items }) => (
            <div key={status}>
              <h3 className="text-xs font-semibold text-ink-soft">
                {STATUS_LABELS[status]}（{items.length}）
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {items.map((coupon) => (
                  <CouponCard key={coupon.id} coupon={coupon} showRevealStatus={showRevealStatus} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {nextHref && (
        <div className="mt-4 flex justify-center">
          <Link
            href={nextHref}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            下一頁 →
          </Link>
        </div>
      )}
    </section>
  );
}

export default async function CouponWalletPage({
  searchParams,
}: {
  searchParams: Promise<{ sharedCursor?: string; receivedCursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { sharedCursor, receivedCursor } = await searchParams;
  const userId = session.user.id;

  const [profile, shared, received] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    fetchSharedCoupons(userId, sharedCursor),
    fetchReceivedCoupons(userId, receivedCursor),
  ]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={profile} />

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 pb-24 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">優惠券錢包</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          你分享出去與接手到的優惠券，狀態都在這裡一目了然。
        </p>

        <CouponSection
          title="我分享的券"
          emptyText="目前還沒有分享任何優惠券。"
          data={shared}
          cursorParam="sharedCursor"
          otherCursorParam="receivedCursor"
          otherCursor={receivedCursor}
          showRevealStatus={false}
        />

        <CouponSection
          title="我接手的券"
          emptyText="目前還沒有接手任何優惠券。"
          data={received}
          cursorParam="receivedCursor"
          otherCursorParam="sharedCursor"
          otherCursor={sharedCursor}
          showRevealStatus={true}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
