import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// DELETE /api/me/privacy-requests/[id] — 冷卻期內撤銷帳號刪除請求（master-plan §7a 交付內容 3）。
// 只有請求本人可以撤銷，且只有 status=cooling_off 才能撤銷（已進入 processing/completed 之後
// 就太遲了）。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const request = await db.privacyRequest.findUnique({ where: { id } });
  if (!request || request.userId !== user.id) {
    return jsonError("NOT_FOUND", "找不到這筆請求");
  }
  if (request.status !== "cooling_off") {
    return jsonError("CONFLICT", "這筆請求目前的狀態無法撤銷");
  }

  const cancelled = await db.privacyRequest.updateMany({
    where: { id, status: "cooling_off" },
    data: { status: "cancelled" },
  });
  if (cancelled.count === 0) {
    // 極端併發：撤銷的當下 job 剛好搶先把它轉成 processing。
    return jsonError("CONFLICT", "這筆請求目前的狀態無法撤銷");
  }

  return NextResponse.json({ id, status: "cancelled" });
}
