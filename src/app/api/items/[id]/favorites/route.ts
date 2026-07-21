import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/items/[id]/favorites — 收藏一個物品（master-plan/docs/plan/m12-product-growth.md
// 交付內容 2）。不限物品狀態皆可收藏（純書籤性質，已完成/已下架的物品也能收藏），撞
// `@@unique([userId, itemId])`（已經收藏過）視為成功，冪等設計。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const item = await db.item.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  // 每小時/每日收藏次數上限，超過回 429（見 src/lib/rate-limit.ts）。放在真的寫入之前，
  // 被擋下的請求不會產生任何副作用。
  try {
    await checkRateLimit(user.id, "favorite_create");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  try {
    await db.itemFavorite.create({ data: { userId: user.id, itemId } });
  } catch (e) {
    // 已經收藏過（撞 unique）：規格明定視為成功，不是錯誤。
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      throw e;
    }
  }

  return NextResponse.json({ favorited: true });
}

// DELETE /api/items/[id]/favorites — 取消收藏。找不到收藏紀錄也回 200（冪等，比照
// M6 web-push 訂閱刪除的既定寬鬆風格）。
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  await db.itemFavorite.deleteMany({ where: { userId: user.id, itemId } });

  return NextResponse.json({ favorited: false });
}
