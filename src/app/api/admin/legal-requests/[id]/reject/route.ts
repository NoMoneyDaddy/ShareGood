import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/admin/legal-requests/[id]/reject — 駁回調閱請求，必填駁回原因（master-plan §7a
// 交付內容 6）。同樣限定 admin 角色，且不能是建檔人自己駁回自己（雙人審核精神一致）。
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
  const body = await req.json().catch(() => null);
  const rejectionReason =
    typeof body?.rejectionReason === "string" ? body.rejectionReason.trim() : "";
  if (!rejectionReason) return jsonError("UNPROCESSABLE", "駁回原因為必填");

  const request = await db.lawEnforcementRequest.findUnique({ where: { id } });
  if (!request) return jsonError("NOT_FOUND", "找不到這筆調閱請求");
  if (request.status !== "submitted" && request.status !== "legal_review") {
    return jsonError("CONFLICT", "這筆請求目前的狀態無法駁回");
  }
  if (request.submittedBy === actor.id) {
    return jsonError("FORBIDDEN", "建檔人不能駁回自己建立的調閱請求，需由另一位 admin 審核");
  }

  await db.$transaction(async (tx) => {
    await tx.lawEnforcementRequest.update({
      where: { id },
      data: { status: "rejected", approvedBy: actor.id, rejectionReason },
    });
    await tx.lawEnforcementRequestEvent.create({
      data: { requestId: id, action: "rejected", actorId: actor.id, note: rejectionReason },
    });
  });

  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.reject",
    targetType: "law_enforcement_request",
    targetId: id,
    detail: { rejectionReason },
    sensitive: true,
  });

  return NextResponse.json({ id, status: "rejected" });
}
