import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/admin/legal-requests/[id]/approve — 核准調閱請求（master-plan §7a 交付內容 6）。
// 雙人審核：核准者必須是 admin 角色，且不能是同一個人建檔（submitted_by !== approved_by），
// 防止單一 admin 濫權調閱使用者私訊等敏感資料。
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const request = await db.lawEnforcementRequest.findUnique({ where: { id } });
  if (!request) return jsonError("NOT_FOUND", "找不到這筆調閱請求");
  if (request.status !== "submitted" && request.status !== "legal_review") {
    return jsonError("CONFLICT", "這筆請求目前的狀態無法核准");
  }
  if (request.submittedBy === actor.id) {
    return jsonError("FORBIDDEN", "建檔人不能核准自己建立的調閱請求，需由另一位 admin 審核");
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.lawEnforcementRequest.update({
      where: { id },
      data: { status: "approved", approvedBy: actor.id, approvedAt: now },
    });
    await tx.lawEnforcementRequestEvent.create({
      data: { requestId: id, action: "approved", actorId: actor.id },
    });
  });

  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.approve",
    targetType: "law_enforcement_request",
    targetId: id,
    sensitive: true,
  });

  return NextResponse.json({ id, status: "approved" });
}
