import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET /api/notifications — 目前登入者的站內通知列表（cursor-based 分頁）。
// 看通知不需要完成 onboarding，所以只檢查登入、不檢查 profile。
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;
  const cursor = searchParams.get("cursor");

  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? notifications[notifications.length - 1].id : null;

  return NextResponse.json({ notifications, nextCursor, unreadCount });
}
