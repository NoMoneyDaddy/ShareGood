import { Gift, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "優惠券錢包" };

const PAGE_SIZE = 20;

const TAIPEI_DATE = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
});

function formatDate(date: Date | null) {
  return date ? TAIPEI_DATE.format(date) : "未設定到期日";
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿（未上架）",
  published: "上架中",
  reserved: "已配對，等待交接",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已到期下架",
  removed_by_user: "已下架",
  removed_by_moderator: "已下架",
};

// 狀態徽章顏色分級，比照 /support 頁「處理中／已解決」的用色慣例：進行中用預設（品牌色）
// 突顯，已完成用 outline 弱化，下架／到期用 destructive 提醒使用者這張券可能已經拿不到手了。
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  published: "default",
  reserved: "secondary",
  handover_pending: "secondary",
  completed: "outline",
  expired: "destructive",
  removed_by_user: "destructive",
  removed_by_moderator: "destructive",
};

type WalletRow = {
  id: string;
  title: string;
  status: string;
  expiresAt: Date | null;
  couponDetail: { faceValue: string; merchantName: string } | null;
};

// 我分享出去的券：我是物主、物品有 CouponDetail。
async function loadSharedCoupons(userId: string, cursor?: string) {
  const rows = await db.item.findMany({
    where: { ownerId: userId, couponDetail: { isNot: null } },
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
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { rows: page as WalletRow[], nextCursor: hasMore ? page[page.length - 1].id : null };
}

// 我接手的券：物品有 CouponDetail，且我是某筆已接受留言／已接受直贈的那個人。這兩個關聯
// 一旦被接受就永久保留 accepted 狀態（不會因為之後進入交接／完成而改變），所以不需要另外
// 查 HandoverRecord 才能判斷「我是不是接手者」，跟物品詳情頁（reserved 階段）判斷方式一致，
// 但這裡涵蓋 reserved 之後的所有階段（handover_pending／completed）。
async function loadReceivedCoupons(userId: string, cursor?: string) {
  const rows = await db.item.findMany({
    where: {
      couponDetail: { isNot: null },
      OR: [
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
      couponDetail: { select: { faceValue: true, merchantName: true } },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  return { rows: page as WalletRow[], nextCursor: hasMore ? page[page.length - 1].id : null };
}

function CouponList({
  rows,
  emptyState,
  canReveal,
}: {
  rows: WalletRow[];
  emptyState: ReactNode;
  canReveal: boolean;
}) {
  if (rows.length === 0) {
    return emptyState;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map((item) => (
        <li key={item.id}>
          <Link
            href={`/items/${item.id}${canReveal ? "#coupon" : ""}`}
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-ink">{item.title}</p>
              <Badge variant={STATUS_VARIANT[item.status] ?? "outline"} className="shrink-0">
                {STATUS_LABEL[item.status] ?? item.status}
              </Badge>
            </div>
            {item.couponDetail && (
              <p className="mt-1 text-sm text-ink-soft">
                {item.couponDetail.faceValue}・{item.couponDetail.merchantName}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
              <span>到期日：{formatDate(item.expiresAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// 優惠券錢包（master-plan §8）：我分享出去的券、我接手到的券各自分列，狀態一目了然。
// 券碼明文不在這裡顯示——維持「只有物品詳情頁的揭露按鈕能看到明文」這個唯一入口，
// 這裡的「查看券碼」連結只是導去物品詳情頁的優惠券區塊（#coupon），不重複揭露邏輯。
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    sharedCursor?: string | string[];
    receivedCursor?: string | string[];
  }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  // Next.js 15 的 searchParams 允許同一個 query key 重複出現而變成陣列
  // （例如 ?sharedCursor=a&sharedCursor=b），若把陣列直接丟進 Prisma 的 cursor
  // 查詢會拋錯導致 500，所以這裡只接受字串，其餘一律當成沒帶 cursor。
  const rawParams = await searchParams;
  const sharedCursor =
    typeof rawParams.sharedCursor === "string" ? rawParams.sharedCursor : undefined;
  const receivedCursor =
    typeof rawParams.receivedCursor === "string" ? rawParams.receivedCursor : undefined;
  const [shared, received] = await Promise.all([
    loadSharedCoupons(userId, sharedCursor),
    loadReceivedCoupons(userId, receivedCursor),
  ]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">優惠券錢包</h1>
      <p className="mt-1.5 text-sm text-ink-soft">你分享出去與接手到的優惠券，狀態一目了然。</p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">我分享的券</h2>
        <CouponList
          rows={shared.rows}
          canReveal={false}
          emptyState={
            <EmptyState
              icon={Ticket}
              title="還沒有分享過優惠券"
              description="上架物品時選擇優惠券分類，就能把用不到的券分享給需要的人。"
              action={{ href: "/items/new", label: "分享優惠券" }}
            />
          }
        />
        {shared.nextCursor && (
          <div className="mt-3">
            <Link
              href={`/me/wallet?sharedCursor=${shared.nextCursor}${
                receivedCursor ? `&receivedCursor=${receivedCursor}` : ""
              }`}
              className="text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            >
              下一頁 →
            </Link>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">我接手的券</h2>
        <CouponList
          rows={received.rows}
          canReveal={true}
          emptyState={
            <EmptyState
              icon={Gift}
              title="還沒有接手過優惠券"
              description="去逛逛好物，說不定有適合你的優惠券正在分享中。"
              action={{ href: "/items", label: "去逛逛好物" }}
            />
          }
        />
        {received.nextCursor && (
          <div className="mt-3">
            <Link
              href={`/me/wallet?receivedCursor=${received.nextCursor}${
                sharedCursor ? `&sharedCursor=${sharedCursor}` : ""
              }`}
              className="text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            >
              下一頁 →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
