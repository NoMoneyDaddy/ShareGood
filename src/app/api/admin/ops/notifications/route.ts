import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";
import { NOTIFICATION_MAX_ATTEMPTS } from "@/lib/ops-config";

// GET /api/admin/ops/notifications — `/admin/ops` 通知分頁（master-plan §8a 交付內容 6＋7）：
// 重送中／已達重試上限的 `notification_deliveries` 列表。moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(req: Request) {
  try {
    await requireOpsAccess();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  // scope=retrying → attempts < 上限（還會被重送 job 挑中）；
  // scope=maxed → attempts >= 上限（已達重試上限，規格要求「標記給 admin 看」）；
  // 不帶則兩者都列出。
  const scope = searchParams.get("scope");
  if (scope && scope !== "retrying" && scope !== "maxed") {
    return jsonError("UNPROCESSABLE", "scope 篩選值需為 retrying 或 maxed");
  }
  const attemptsFilter =
    scope === "retrying"
      ? { lt: NOTIFICATION_MAX_ATTEMPTS }
      : scope === "maxed"
        ? { gte: NOTIFICATION_MAX_ATTEMPTS }
        : undefined;

  const rows = await db.notificationDelivery.findMany({
    where: {
      status: "failed",
      ...(attemptsFilter ? { attempts: attemptsFilter } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      notification: {
        select: {
          userId: true,
          type: true,
          payload: true,
          user: { select: { profile: { select: { nickname: true } } } },
        },
      },
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    maxAttempts: NOTIFICATION_MAX_ATTEMPTS,
    deliveries: page.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      attempts: d.attempts,
      maxed: d.attempts >= NOTIFICATION_MAX_ATTEMPTS,
      lastError: d.lastError,
      lastAttemptAt: d.lastAttemptAt,
      createdAt: d.createdAt,
      notification: {
        userId: d.notification.userId,
        nickname: d.notification.user.profile?.nickname ?? "好物共享用戶",
        type: d.notification.type,
        payload: d.notification.payload,
      },
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
