import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
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

  // 正式上線衝刺（貢獻值排行榜＋徽章）：私訊對話成員只有兩人，直接查兩人的身份組，
  // 讓官方管理團隊／社群管理人員插手交接私訊時對方看得出來、能增加信任感。一般使用者
  // 之間的私訊不會查到任何角色，UI 端不顯示任何徽章。
  const memberRoleRows = await db.userRole.findMany({
    where: { userId: { in: conversation.members.map((m) => m.userId) } },
    select: { userId: true, role: true },
  });
  const memberRoles: Record<string, string[]> = {};
  for (const r of memberRoleRows) {
    memberRoles[r.userId] = [...(memberRoles[r.userId] ?? []), r.role];
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href={`/items/${conversation.item.id}`}
        className="text-sm text-ink-soft hover:text-ink"
      >
        ← 回到「{conversation.item.title}」
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">交接私訊</h1>

      <div className="mt-6">
        <ConversationThread
          conversationId={conversation.id}
          currentUserId={session.user.id}
          initialMessages={initialMessages}
          memberRoles={memberRoles}
        />
      </div>
    </div>
  );
}
