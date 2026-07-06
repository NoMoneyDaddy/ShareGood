import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/items/[id]/thanks — 接手者留感謝訊息給物主（單向，接手者 → 物主；一個
// 物品限一則感謝留言）。
//
// 防重複用 ThanksMessage.itemId 的 unique constraint：直接 create，違反 unique
// 時 catch P2002 回 409，跟 claims 那支 API 認領搶佔時同一招（見該檔案），比先
// findFirst 再 create 更省一趟查詢，也不會有兩個併發請求都通過 findFirst 檢查、
// 各自建立一則造成重複留言的競態。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { handoverRecord: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  if (item.status !== "completed") {
    return jsonError("CONFLICT", "這個物品還沒完成分享，無法留言感謝");
  }

  if (item.handoverRecord?.receiverId !== user.id) {
    return jsonError("FORBIDDEN", "只有接手者可以留言感謝");
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < 1 || message.length > 300) {
    return jsonError("UNPROCESSABLE", "感謝留言需為 1–300 個字");
  }

  let created: { id: string; message: string; createdAt: Date };
  try {
    // 留言與通知包在同一個 transaction：避免通知寫入萬一失敗時，感謝留言已落庫但整支
    // API 回應 500，使用者重試又被 unique constraint 擋成「已經留過感謝了」，卻不知道
    // 自己第一次其實已經成功、只是物主沒收到通知。
    created = await db.$transaction(async (tx) => {
      const thanksMessage = await tx.thanksMessage.create({
        data: { itemId, fromUserId: user.id, toUserId: item.ownerId, message },
        select: { id: true, message: true, createdAt: true },
      });
      // NotificationType 沒有專屬的「收到感謝」類型；重用 completion_confirmed——語意上都是
      // 「這筆分享圓滿收尾」的通知，額外在 payload 帶 thanksMessage，讓之後想做通知詳情頁時
      // 能分辨這則是連帶感謝訊息的完成通知。
      await tx.notification.create({
        data: {
          userId: item.ownerId,
          type: "completion_confirmed",
          payload: { itemId: item.id, itemTitle: item.title, thanksMessage: message },
        },
      });
      return thanksMessage;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "已經留過感謝了");
    }
    throw e;
  }

  return NextResponse.json(created, { status: 201 });
}
