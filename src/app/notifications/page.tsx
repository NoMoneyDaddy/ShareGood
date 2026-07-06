import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
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
function describeNotification(type: string, payload: unknown): string {
  const p = asPayloadRecord(payload);
  switch (type) {
    case "new_comment":
      return `有人在你的物品「${itemTitleOf(p)}」留言了`;
    case "claim_accepted":
      return `「${itemTitleOf(p)}」已經確定給你了！`;
    case "direct_share_received":
      return `你收到一份直接贈與：「${itemTitleOf(p)}」`;
    case "handover_message":
      return `「${itemTitleOf(p)}」有新的交接訊息`;
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
    <main className="mx-auto w-full max-w-lg px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">通知</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        留言、認領、直贈與交接的最新消息都會顯示在這裡。
      </p>

      {notifications.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-soft">目前還沒有通知。</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {notifications.map((n) => {
            const payload = asPayloadRecord(n.payload);
            const itemId = itemIdOf(payload);
            const message = describeNotification(n.type, n.payload);
            const timeLabel = formatTime(n.createdAt);

            return (
              <li key={n.id}>
                {itemId ? (
                  <NotificationRow
                    id={n.id}
                    href={`/items/${itemId}`}
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
          <Link
            href={`/notifications?cursor=${nextCursor}`}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
