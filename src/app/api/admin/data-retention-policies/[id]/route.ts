import { NextResponse } from "next/server";
import { RetentionAction } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const VALID_ACTIONS = new Set<string>(Object.values(RetentionAction));

// PATCH /api/admin/data-retention-policies/[id] — 調整保留天數/動作/是否啟用
// （master-plan §7a 交付內容 4）。只有 admin 可以修改（比機關調閱、legal hold 稍寬鬆的
// moderator 唯讀權限再收斂一層：retention 政策直接影響全站資料存續，限 admin）。
//
// 欄位不變式（schema 設計就是這樣要求）：retentionDays 為 null 時 action 也必須是 null，
// 兩者同時為 null 才代表「不自動清理」；不能一個 null 一個非 null。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const { id } = await params;
  const existing = await db.dataRetentionPolicy.findUnique({ where: { id } });
  if (!existing) return jsonError("NOT_FOUND", "找不到這筆政策");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("UNPROCESSABLE", "請求格式不正確");

  const retentionDays = "retentionDays" in body ? body.retentionDays : existing.retentionDays;
  const action = "action" in body ? body.action : existing.action;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : existing.isActive;

  if (
    retentionDays !== null &&
    (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 0)
  ) {
    return jsonError("UNPROCESSABLE", "retentionDays 需為 null 或非負整數");
  }
  if (action !== null && !VALID_ACTIONS.has(action)) {
    return jsonError("UNPROCESSABLE", "無效的 action");
  }
  if ((retentionDays === null) !== (action === null)) {
    return jsonError("UNPROCESSABLE", "retentionDays 與 action 必須同時為 null 或同時有值");
  }

  const updated = await db.dataRetentionPolicy.update({
    where: { id },
    data: { retentionDays, action, isActive, updatedBy: actor.id },
  });

  await writeAudit({
    actorId: actor.id,
    action: "data_retention_policy.update",
    targetType: "data_retention_policy",
    targetId: id,
    detail: {
      policyKey: updated.policyKey,
      retentionDays: updated.retentionDays,
      action: updated.action,
      isActive: updated.isActive,
    },
  });

  return NextResponse.json({
    id: updated.id,
    policyKey: updated.policyKey,
    retentionDays: updated.retentionDays,
    action: updated.action,
    isActive: updated.isActive,
  });
}
