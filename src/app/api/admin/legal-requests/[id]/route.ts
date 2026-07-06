import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// GET /api/admin/legal-requests/[id] — 調閱請求詳情：目標範圍、公文、逐筆事件時間序、
// 已產生的匯出包。moderator/admin 皆可查看。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const { id } = await params;
  const request = await db.lawEnforcementRequest.findUnique({
    where: { id },
    include: {
      targets: true,
      documents: true,
      events: { orderBy: { createdAt: "asc" } },
      exports: true,
    },
  });
  if (!request) return jsonError("NOT_FOUND", "找不到這筆調閱請求");

  return NextResponse.json({
    id: request.id,
    agencyName: request.agencyName,
    caseReference: request.caseReference,
    legalBasis: request.legalBasis,
    requestScope: request.requestScope,
    receivedAt: request.receivedAt,
    status: request.status,
    submittedBy: request.submittedBy,
    approvedBy: request.approvedBy,
    approvedAt: request.approvedAt,
    rejectionReason: request.rejectionReason,
    notifyUser: request.notifyUser,
    notifiedAt: request.notifiedAt,
    targets: request.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })),
    documents: request.documents.map((d) => ({
      id: d.id,
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt,
    })),
    events: request.events.map((e) => ({
      action: e.action,
      actorId: e.actorId,
      note: e.note,
      createdAt: e.createdAt,
    })),
    exports: request.exports.map((e) => ({
      id: e.id,
      generatedAt: e.generatedAt,
      expiresAt: e.expiresAt,
    })),
  });
}
