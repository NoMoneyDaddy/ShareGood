import { type NextRequest, NextResponse } from "next/server";
import { RestrictionType } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const VALID_TYPES = new Set<string>(Object.values(RestrictionType));
const REASON_MIN = 1;
const REASON_MAX = 500;

// POST /api/admin/user-restrictions — moderator/admin 對使用者建立功能限制
// （master-plan §7「功能限制」）。body: { userId, type, reason, expiresAt? }。
// expiresAt 省略或 null 代表永久限制。
export async function POST(req: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const type = typeof body?.type === "string" ? body.type : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const expiresAtRaw = body?.expiresAt;

  if (!userId) {
    return jsonError("UNPROCESSABLE", "請指定使用者");
  }
  if (!VALID_TYPES.has(type)) {
    return jsonError("UNPROCESSABLE", "無效的限制類型");
  }
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return jsonError("UNPROCESSABLE", `限制原因需為 ${REASON_MIN}–${REASON_MAX} 個字`);
  }

  let expiresAt: Date | null = null;
  if (expiresAtRaw !== undefined && expiresAtRaw !== null) {
    if (typeof expiresAtRaw !== "string") {
      return jsonError("UNPROCESSABLE", "到期時間格式不正確");
    }
    const parsed = new Date(expiresAtRaw);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return jsonError("UNPROCESSABLE", "到期時間需為未來時間");
    }
    expiresAt = parsed;
  }

  const targetUser = await db.user.findUnique({
    where: { id: userId },
    include: { roles: true },
  });
  if (!targetUser) {
    return jsonError("NOT_FOUND", "找不到這個使用者");
  }

  // RBAC 邊界：moderator 不能限制 admin 帳號（moderator 不能改 admin 的權限）。
  const actorRoles = new Set(actor.roles.map((r) => r.role));
  const targetIsAdmin = targetUser.roles.some((r) => r.role === "admin");
  if (targetIsAdmin && !actorRoles.has("admin")) {
    return jsonError("FORBIDDEN", "moderator 不能限制 admin 帳號");
  }

  const restriction = await db.userRestriction.create({
    data: {
      userId,
      type: type as RestrictionType,
      reason,
      expiresAt,
      createdBy: actor.id,
    },
  });

  await writeAudit({
    actorId: actor.id,
    action: "user_restriction.create",
    targetType: "user",
    targetId: userId,
    detail: {
      restrictionId: restriction.id,
      type: restriction.type,
      reason: restriction.reason,
      expiresAt: restriction.expiresAt ? restriction.expiresAt.toISOString() : null,
    },
  });

  return NextResponse.json(
    {
      id: restriction.id,
      userId: restriction.userId,
      type: restriction.type,
      reason: restriction.reason,
      expiresAt: restriction.expiresAt,
      createdAt: restriction.createdAt,
    },
    { status: 201 },
  );
}
