import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/storage";

const EXPIRES_IN_SECONDS = 15 * 60;

// GET /api/admin/legal-requests/[id]/exports/[exportId]/download — 只有 admin 角色能取得
// 下載連結，且每次下載寫入 law_enforcement_request_events（action=export_downloaded）
// （master-plan §7a 交付內容 6）。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; exportId: string }> },
) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const { id, exportId } = await params;
  const exportRow = await db.lawEnforcementExport.findUnique({
    where: { id: exportId },
    include: { storageObject: true },
  });
  if (!exportRow || exportRow.requestId !== id) {
    return jsonError("NOT_FOUND", "找不到這筆匯出紀錄");
  }

  const url = await getPresignedDownloadUrl(exportRow.storageObject.objectKey, EXPIRES_IN_SECONDS);

  await db.lawEnforcementRequestEvent.create({
    data: { requestId: id, action: "export_downloaded", actorId: actor.id },
  });
  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.export_download",
    targetType: "law_enforcement_request",
    targetId: id,
    detail: { exportId },
    sensitive: true,
  });

  return NextResponse.json({ url, expiresInSeconds: EXPIRES_IN_SECONDS });
}
