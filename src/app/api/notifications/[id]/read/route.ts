import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/notifications/[id]/read — 把單一通知標記已讀。
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const notification = await db.notification.findUnique({ where: { id } });
  if (!notification) return jsonError("NOT_FOUND", "找不到這則通知");
  if (notification.userId !== user.id) {
    return jsonError("FORBIDDEN", "無法標記他人的通知");
  }

  if (!notification.readAt) {
    await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  return NextResponse.json({ ok: true });
}
