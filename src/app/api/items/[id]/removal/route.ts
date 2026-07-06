import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// GET /api/items/[id]/removal — 查詢物品的強制下架紀錄。
// 權限：只有物主本人與 moderator/admin 看得到（下架原因可能涉及檢舉細節，不公開）；
// 其他人（含一般訪客、非物主的一般使用者）一律 404，不透露「這個物品是否被下架過」。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;

  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, ownerId: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  const roles = new Set(user.roles.map((r) => r.role));
  const isModerator = roles.has("moderator") || roles.has("admin");
  const isOwner = user.id === item.ownerId;
  if (!isOwner && !isModerator) {
    return jsonError("NOT_FOUND", "找不到這個物品");
  }

  const removal = await db.itemRemoval.findFirst({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reason: true,
      note: true,
      createdAt: true,
      moderatorId: true,
      moderator: { select: { profile: { select: { nickname: true } } } },
    },
  });
  if (!removal) return jsonError("NOT_FOUND", "這個物品沒有下架紀錄");

  return NextResponse.json({
    id: removal.id,
    reason: removal.reason,
    note: removal.note,
    createdAt: removal.createdAt,
    // moderatorId 可能是 null（moderator 帳號後來被刪除，schema 設計是 onDelete: SetNull
    // 以保留稽核紀錄），moderator 暱稱同理可能拿不到，前端顯示要處理保底文字。
    moderator: removal.moderatorId
      ? { nickname: removal.moderator?.profile?.nickname ?? null }
      : null,
  });
}
