import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/storage";

// GET /api/me/data-exports/[id]/download — 取得本次資料匯出包的簽名下載連結
// （master-plan §7a 交付內容 2）。短效期一次性連結，每次呼叫都重新簽一個，不回傳固定網址。
const EXPIRES_IN_SECONDS = 15 * 60; // 15 分鐘

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const dataExport = await db.dataExport.findUnique({
    where: { id },
    include: { storageObject: true },
  });
  if (!dataExport || dataExport.userId !== user.id) {
    return jsonError("NOT_FOUND", "找不到這筆匯出紀錄");
  }
  if (dataExport.status === "expired") {
    return jsonError("NOT_FOUND", "這份匯出包已經過期並被清除");
  }
  if (dataExport.status !== "ready" || !dataExport.storageObject) {
    return jsonError("CONFLICT", "匯出包尚未就緒，請稍後再試");
  }

  const url = await getPresignedDownloadUrl(dataExport.storageObject.objectKey, EXPIRES_IN_SECONDS);

  await db.dataExport.update({
    where: { id: dataExport.id },
    data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
  });

  return NextResponse.json({ url, expiresInSeconds: EXPIRES_IN_SECONDS });
}
