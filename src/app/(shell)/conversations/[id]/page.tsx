import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { BackBar } from "@/components/back-bar";
import { db } from "@/lib/db";
import { ConversationThread } from "./conversation-thread";

export const metadata = { title: "私訊", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

// 對話頁：只有交接雙方能看，非成員一律 notFound()（跟 API 端一致，404 比 403 更保守，
// 不洩漏「這個 conversation 存在」的事實）。
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/");

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      item: { select: { id: true, title: true } },
      members: { select: { userId: true } },
    },
  });
  if (!conversation?.members.some((m) => m.userId === session.user.id)) {
    notFound();
  }

  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
    select: { id: true, senderId: true, body: true, createdAt: true },
  });
  const initialMessages = [...rows].reverse().map((m) => ({
    id: m.id,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <BackBar
        fallbackHref={`/items/${conversation.item.id}`}
        label={`回到「${conversation.item.title}」`}
      />
      <h1 className="mt-2 text-2xl font-bold tracking-tight">交接私訊</h1>

      <div className="mt-6">
        <ConversationThread
          conversationId={conversation.id}
          currentUserId={session.user.id}
          initialMessages={initialMessages}
        />
      </div>
    </div>
  );
}
