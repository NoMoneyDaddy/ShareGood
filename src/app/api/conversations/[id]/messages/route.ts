import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { createOrMergeNotification } from "@/lib/notifications";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// 是否為這個 conversation 的成員；非成員一律當作「找不到」（見下方 GET/POST 說明）。
async function isMember(conversationId: string, userId: string) {
  const membership = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  return membership !== null;
}

// GET /api/conversations/[id]/messages — 訊息列表（cursor-based 分頁）。
// 非成員回 404 而不是 403：連「這個 conversation 存在」都不該讓非成員知道
// （master-plan 驗收清單：「非交接雙方的第三人讀取該 conversation → 404/403」，兩者都算過，
// 但 404 更保守，這裡優先選 404）。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: conversationId } = await params;
  if (!(await isMember(conversationId, user.id))) {
    return jsonError("NOT_FOUND", "找不到這個對話");
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  // 排序方向跟其他列表 API 一致（最新的在前），cursor 往舊訊息翻頁；前端顯示時再反轉成
  // 由舊到新（聊天視覺習慣）。
  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      senderId: true,
      body: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    messages: page.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

// POST /api/conversations/[id]/messages — 發送訊息（僅限成員；同上 404 判斷）。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: conversationId } = await params;
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      item: { select: { id: true, title: true } },
      members: { select: { userId: true } },
    },
  });
  if (!conversation?.members.some((m) => m.userId === user.id)) {
    return jsonError("NOT_FOUND", "找不到這個對話");
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.body === "string" ? body.body.trim() : "";
  if (message.length < 1 || message.length > 1000) {
    return jsonError("UNPROCESSABLE", "訊息需為 1–1000 個字");
  }

  const created = await db.message.create({
    data: { conversationId, senderId: user.id, body: message },
    select: { id: true, senderId: true, body: true, createdAt: true },
  });

  // 通知「另一位成員」（不是自己）有新的交接訊息。這是最容易短時間內連發好幾則的場景
  // （雙方你一言我一語聊交接細節），所以用 createOrMergeNotification：30 分鐘窗口內對
  // 同一物品的多則 handover_message 只會合併成一筆未讀通知（見 src/lib/notifications.ts），
  // 不會每傳一句話就轟炸對方一則新通知。
  //
  // 訊息本體已經成功寫入資料庫，通知只是附加效果：通知建立失敗（例如暫時性的資料庫連線
  // 問題）不該讓這支 API 回 500，否則使用者會誤以為訊息沒送出而重試，造成重複訊息。
  // 因此這裡刻意不讓錯誤往外拋，只記錄 log。
  const otherMember = conversation.members.find((m) => m.userId !== user.id);
  if (otherMember) {
    try {
      await createOrMergeNotification(db, {
        userId: otherMember.userId,
        type: "handover_message",
        payload: {
          itemId: conversation.item.id,
          itemTitle: conversation.item.title,
          conversationId: conversation.id,
        },
      });
    } catch (e) {
      console.error("createOrMergeNotification failed for handover_message", e);
    }
  }

  return NextResponse.json(created, { status: 201 });
}
