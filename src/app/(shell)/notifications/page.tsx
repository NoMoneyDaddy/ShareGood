import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { mergedCountOf } from "@/lib/notifications";
import { NotificationRow } from "./notification-row";

export const metadata = { title: "通知" };

const PAGE_SIZE = 20;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

function formatTime(date: Date) {
  return TAIPEI_FORMATTER.format(date);
}

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function itemTitleOf(payload: Record<string, unknown>) {
  return typeof payload.itemTitle === "string" && payload.itemTitle.length > 0
    ? payload.itemTitle
    : "這個物品";
}

function itemIdOf(payload: Record<string, unknown>) {
  return typeof payload.itemId === "string" && payload.itemId.length > 0 ? payload.itemId : null;
}

// M1 最小版通知中心：被留言、被接受、被直贈、交接訊息、完成確認，各自組成一句繁體中文。
// 不認得的 type 就顯示保底文字，避免未來新增 type 忘記處理時整頁壞掉。
//
// M2 強制下架：master-plan §7 沒有替這個事件新增專屬 NotificationType（維持
// prisma/schema.prisma 不動），寫入端（src/app/api/items/[id]/force-remove/route.ts）
// 複用了既有的 handover_message type，但在 payload 帶 kind: "item_force_removed" 當
// 判別欄位，這裡優先檢查它、蓋掉原本 handover_message 的文案。force-remove 是低頻的
// moderation 事件（沒有走 M4 合併 helper，也不會短時間連發），所以不需要 mergedCount 分支。
//
// M3 到期 job（master-plan §8）比照同一套做法：重用 completion_confirmed type，
// payload 帶 kind: "item_expired" / "item_expiring_reminder"（見
// src/app/api/jobs/item-expiration/route.ts），這裡一併優先檢查。
//
// M5 抽籤（master-plan §5a）沿用同一套「重用 completion_confirmed type，payload 帶 kind
// 判別欄位」做法（不新增 NotificationType 列，維持 prisma/schema.prisma 不動）：
// lottery_won／lottery_drawn／lottery_backup_offered／lottery_progress／lottery_failed／
// lottery_cancelled，見 src/lib/lottery.ts 與 src/app/api/lotteries/[id]/cancel/route.ts。
//
// M4 通知合併（見 src/lib/notifications.ts 的 createOrMergeNotification）：同一物品在
// 30 分鐘窗口內的同類型事件會合併成一筆，payload.mergedCount 帶目前累積的筆數。這裡只有
// 「短時間內容易連發」的 new_comment／handover_message 兩種特別組聚合文字（例如「有 3 則
// 新留言」），其餘 type 目前現實中不會連發（一個物品只會有一次認領/直贈/完成事件），
// mergedCount > 1 時沿用原本的單則文字即可，不需要特別處理。
function describeNotification(type: string, payload: unknown): string {
  const p = asPayloadRecord(payload);
  if (p.kind === "item_force_removed") {
    return `你的物品「${itemTitleOf(p)}」已被管理員下架`;
  }
  if (p.kind === "item_expired") {
    return `「${itemTitleOf(p)}」已到期下架，之後可以重新上架分享`;
  }
  if (p.kind === "item_expiring_reminder") {
    return `「${itemTitleOf(p)}」即將到期，記得儘快促成分享`;
  }
  if (p.kind === "lottery_won") {
    return `恭喜！你在「${itemTitleOf(p)}」的抽籤中中選了，請於 48 小時內確認`;
  }
  if (p.kind === "lottery_drawn") {
    return `「${itemTitleOf(p)}」已完成開獎，正在等待中選者確認`;
  }
  if (p.kind === "lottery_backup_offered") {
    return `「${itemTitleOf(p)}」的抽籤遞補到你了，請於 48 小時內確認`;
  }
  if (p.kind === "lottery_progress") {
    return `「${itemTitleOf(p)}」的抽籤正在遞補下一位候選人`;
  }
  if (p.kind === "lottery_failed") {
    return `「${itemTitleOf(p)}」的抽籤流標了，已恢復開放，可改用留言或直贈分享`;
  }
  if (p.kind === "lottery_cancelled") {
    return `你參加的「${itemTitleOf(p)}」抽籤已被物主取消`;
  }
  // M6 訂閱通知（master-plan §6a）：NotificationType enum 沒有專屬類型（維持
  // prisma/schema.prisma 不動），沿用上面 M2/M3 已經立下的既定做法，重用
  // completion_confirmed type，用 payload.kind 判別（見 src/lib/subscription-notify.ts）。
  if (p.kind === "subscription_match") {
    const subscriptionLabel =
      typeof p.subscriptionLabel === "string" && p.subscriptionLabel ? p.subscriptionLabel : "條件";
    return `你訂閱的「${subscriptionLabel}」有新物品：《${itemTitleOf(p)}》`;
  }
  if (p.kind === "subscription_digest") {
    const totalCount = typeof p.totalCount === "number" ? p.totalCount : 0;
    return `今天有 ${totalCount} 件符合你訂閱條件的新物品，點我查看摘要`;
  }
  const count = mergedCountOf(payload);
  switch (type) {
    case "new_comment":
      return count > 1
        ? `你的物品「${itemTitleOf(p)}」收到了 ${count} 則新留言`
        : `有人在你的物品「${itemTitleOf(p)}」留言了`;
    case "claim_accepted":
      return `「${itemTitleOf(p)}」已經確定給你了！`;
    case "direct_share_received":
      return `你收到一份直接贈與：「${itemTitleOf(p)}」`;
    case "handover_message":
      return count > 1
        ? `「${itemTitleOf(p)}」有 ${count} 則新的交接訊息`
        : `「${itemTitleOf(p)}」有新的交接訊息`;
    case "completion_confirmed":
      return `「${itemTitleOf(p)}」已完成分享，記得留言感謝對方！`;
    default:
      return "你有一則新通知";
  }
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { cursor } = await searchParams;
  const userId = session.user.id;

  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const notifications = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? notifications[notifications.length - 1].id : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">通知</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            留言、認領、直贈與交接的最新消息都會顯示在這裡。
          </p>
        </div>
        <div className="mt-1 flex shrink-0 flex-col items-end gap-1 whitespace-nowrap text-sm font-medium">
          <Link
            href="/me/wallet"
            className="text-ink-soft underline-offset-4 hover:text-ink hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            優惠券錢包
          </Link>
          <Link
            href="/me/notification-preferences"
            className="text-ink-soft underline-offset-4 hover:text-ink hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            通知設定
          </Link>
          <Link
            href="/me/subscriptions"
            className="text-ink-soft underline-offset-4 hover:text-ink hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            我的訂閱
          </Link>
        </div>
      </div>

      {notifications.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-soft">目前還沒有通知。</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {notifications.map((n) => {
            const payload = asPayloadRecord(n.payload);
            // M6 訂閱每日摘要沒有單一 itemId（內容是多筆物品清單），點進去改導向
            // /me/subscriptions 讓使用者查看完整訂閱與命中狀況，而不是連去某一個物品。
            const itemId = payload.kind === "subscription_digest" ? null : itemIdOf(payload);
            const href =
              payload.kind === "subscription_digest"
                ? "/me/subscriptions"
                : itemId
                  ? `/items/${itemId}`
                  : null;
            const message = describeNotification(n.type, n.payload);
            const timeLabel = formatTime(n.createdAt);

            return (
              <li key={n.id}>
                {href ? (
                  <NotificationRow
                    id={n.id}
                    href={href}
                    initialReadAt={n.readAt?.toISOString() ?? null}
                    message={message}
                    timeLabel={timeLabel}
                  />
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink-soft">{message}</p>
                      <span className="mt-1 block text-xs text-ink-soft">{timeLabel}</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          {/* 這是 server component 的整頁換頁（不是 client-side append），文字用「下一頁」
              精確表達行為；瀏覽器上一頁鍵可以正確返回前一頁的通知列表。 */}
          <Link
            href={`/notifications?cursor=${nextCursor}`}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            下一頁 →
          </Link>
        </div>
      )}
    </div>
  );
}
