import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { db } from "@/lib/db";

export const metadata = { title: "我的對話", robots: { index: false, follow: false } };

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// 我的對話列表：M1 最小版，一次全部列出（交接對話量對單一使用者來說不會太多，
// 先不做分頁；量真的大了再補 cursor，跟其他列表 API 一樣的做法）。
export default async function ConversationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const memberships = await db.conversationMember.findMany({
    where: { userId: session.user.id },
    select: {
      joinedAt: true,
      conversation: {
        select: {
          id: true,
          item: { select: { id: true, title: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, createdAt: true, senderId: true },
          },
        },
      },
    },
  });

  // 依「最新一則訊息時間」排序，沒有訊息的對話 fallback 用 joinedAt；訊息串通常不多，
  // 這裡在記憶體排序即可，不需要 Prisma 對 to-many 關聯做 aggregate orderBy。
  memberships.sort((a, b) => {
    const aTime = a.conversation.messages[0]?.createdAt ?? a.joinedAt;
    const bTime = b.conversation.messages[0]?.createdAt ?? b.joinedAt;
    return bTime.getTime() - aTime.getTime();
  });

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">我的對話</h1>
      <p className="mt-1.5 text-sm text-ink-soft">交接時跟對方的私訊都在這裡。</p>

      {memberships.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="目前還沒有交接對話"
          description="認領或收到直贈的物品後，跟對方的交接私訊會顯示在這裡。"
          action={{ href: "/items", label: "去逛逛好物" }}
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {memberships.map(({ conversation }) => {
            const lastMessage = conversation.messages[0];
            return (
              <li key={conversation.id}>
                <Link
                  href={`/conversations/${conversation.id}`}
                  className="flex flex-col gap-1 rounded-xl border border-line bg-card px-4 py-3.5 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="text-sm font-semibold text-ink">{conversation.item.title}</span>
                  <span className="truncate text-sm text-ink-soft">
                    {lastMessage ? lastMessage.body : "還沒有訊息"}
                  </span>
                  {lastMessage && (
                    <span className="text-xs text-ink-soft">
                      {TAIPEI_FORMATTER.format(lastMessage.createdAt)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
