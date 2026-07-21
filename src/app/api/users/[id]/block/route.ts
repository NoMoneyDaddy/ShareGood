import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/users/[id]/block — 封鎖使用者（docs/plan/m12-product-growth.md 交付內容 3）。
// 單向即生效，不需要對方同意；撞 `@@unique([blockerId, blockedId])`（已經封鎖過）視為成功，
// 冪等設計。⚠️ 無感知封鎖（silent block）：這支 API 本身對「封鎖發起人」完全透明（他當然
// 知道自己封鎖了誰），無感知只針對「被封鎖的那一方」——被封鎖方在別的 API（claims／
// direct-shares）被擋下時看到的是通用錯誤訊息，不會知道自己被封鎖。
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

  const { id: blockedId } = await params;
  if (blockedId === user.id) {
    return jsonError("UNPROCESSABLE", "不能封鎖自己");
  }

  const target = await db.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) return jsonError("NOT_FOUND", "找不到這位使用者");

  try {
    await db.userBlock.create({ data: { blockerId: user.id, blockedId } });
  } catch (e) {
    // 已經封鎖過（撞 unique）：規格明定視為成功，不是錯誤。
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      throw e;
    }
  }

  return NextResponse.json({ blocked: true });
}

// DELETE /api/users/[id]/block — 解除封鎖。找不到封鎖紀錄也回 200（冪等）。
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

  const { id: blockedId } = await params;
  await db.userBlock.deleteMany({ where: { blockerId: user.id, blockedId } });

  return NextResponse.json({ blocked: false });
}
