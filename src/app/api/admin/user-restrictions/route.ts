import { type NextRequest, NextResponse } from "next/server";
import { RestrictionType } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

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

  // M2 治理底線 §7「功能限制」：疊加檢查，操作者自己若被全站封鎖（full_block），
  // 即使角色還沒被立刻停用，也不能繼續建立限制。
  const actorRestriction = await checkFullBlock(actor.id);
  if (actorRestriction.blocked) {
    return jsonError("FORBIDDEN", actorRestriction.message);
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

  // 同一使用者同類型不能疊加多筆生效中的限制：否則之後解除只會解除其中一筆，
  // 其餘還在生效，違反直覺（見 PR review）。schema 已凍結不能加 unique constraint，
  // 改用 Postgres advisory lock 鎖住「這個使用者＋這個限制類型」的組合，讓檢查與建立
  // 在同一個 transaction 內對同一組 key 互斥，避免兩個管理員同時操作時都通過檢查、
  // 各自建立一筆造成重複。
  const now = new Date();
  try {
    const restriction = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${type}`}))`;
      const existing = await tx.userRestriction.findFirst({
        where: {
          userId,
          type: type as RestrictionType,
          liftedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (existing) {
        throw new Error("DUPLICATE_RESTRICTION");
      }

      return tx.userRestriction.create({
        data: {
          userId,
          type: type as RestrictionType,
          reason,
          expiresAt,
          createdBy: actor.id,
        },
      });
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
  } catch (e) {
    if (e instanceof Error && e.message === "DUPLICATE_RESTRICTION") {
      return jsonError("CONFLICT", "該使用者目前已有生效中的同類型限制");
    }
    throw e;
  }
}
