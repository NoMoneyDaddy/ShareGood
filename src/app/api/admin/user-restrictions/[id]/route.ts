import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// DELETE /api/admin/user-restrictions/[id] — moderator/admin 提前解除一筆限制
// （master-plan §7「功能限制」）。已經解除過的再次呼叫回 409（idempotent 保護，不是靜默成功，
// 讓後台操作者知道這筆已經處理過）。
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，操作者自己若被全站封鎖（full_block），
  // 即使角色還沒被立刻停用，也不能繼續解除限制。
  const actorRestriction = await checkFullBlock(actor.id);
  if (actorRestriction.blocked) {
    return jsonError("FORBIDDEN", actorRestriction.message);
  }

  const { id } = await params;
  const restriction = await db.userRestriction.findUnique({
    where: { id },
    include: { user: { include: { roles: true } } },
  });
  if (!restriction) {
    return jsonError("NOT_FOUND", "找不到這筆限制紀錄");
  }

  // RBAC 邊界：moderator 不能解除 admin 帳號身上的限制（跟建立限制同一條邊界）。
  const actorRoles = new Set(actor.roles.map((r) => r.role));
  const targetIsAdmin = restriction.user.roles.some((r) => r.role === "admin");
  if (targetIsAdmin && !actorRoles.has("admin")) {
    return jsonError("FORBIDDEN", "moderator 不能解除 admin 帳號的限制");
  }

  // 用 updateMany 的 where 條件把「檢查 liftedAt」與「寫入 liftedAt」合成一個原子操作，
  // 避免多個管理員同時解除同一筆限制時的競態條件（先查後寫會被兩者都通過檢查後重複解除）。
  const now = new Date();
  const updated = await db.userRestriction.updateMany({
    where: { id, liftedAt: null },
    data: { liftedAt: now, liftedBy: actor.id },
  });

  if (updated.count === 0) {
    return jsonError("CONFLICT", "這筆限制已經被解除過了");
  }

  await writeAudit({
    actorId: actor.id,
    action: "user_restriction.lift",
    targetType: "user",
    targetId: restriction.userId,
    detail: { restrictionId: id, type: restriction.type },
  });

  return NextResponse.json({ id, liftedAt: now });
}
