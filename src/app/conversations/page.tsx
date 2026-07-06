import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
    orderBy: { joinedAt: "desc" },
    select: {
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

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">我的對話</h1>
      <p className="mt-1.5 text-sm text-ink-soft">交接時跟對方的私訊都在這裡。</p>

      {memberships.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-soft">目前還沒有交接對話。</p>
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
    </main>
  );
}
