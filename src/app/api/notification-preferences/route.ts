import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  getEventTypeDefaults,
  isNotificationEventType,
  mergeWithDefaults,
} from "@/lib/notification-preferences";
import { checkFullBlock } from "@/lib/restrictions";

// GET /api/notification-preferences — 目前登入者每一類事件的通知偏好（站內/外部各自開關）。
// 看偏好設定不需要完成 onboarding，比照 /api/notifications 只檢查登入、不檢查 profile。
export async function GET() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const rows = await db.notificationPreference.findMany({
    where: { userId: user.id },
    select: { eventType: true, inAppEnabled: true, externalEnabled: true },
  });

  return NextResponse.json({ preferences: mergeWithDefaults(rows) });
}

// PATCH /api/notification-preferences — 更新單一事件類型的站內/外部通知開關。
// body: { eventType: string, inAppEnabled?: boolean, externalEnabled?: boolean }
// 兩個欄位至少要帶一個；沒帶的欄位維持原狀（第一次寫入時 fallback 回程式碼裡的預設值）。
export async function PATCH(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const body = await req.json().catch(() => null);
  const eventType = typeof body?.eventType === "string" ? body.eventType : "";
  if (!isNotificationEventType(eventType)) {
    return jsonError("UNPROCESSABLE", "無效的事件類型");
  }

  const data: { inAppEnabled?: boolean; externalEnabled?: boolean } = {};
  if (typeof body?.inAppEnabled === "boolean") data.inAppEnabled = body.inAppEnabled;
  if (typeof body?.externalEnabled === "boolean") data.externalEnabled = body.externalEnabled;
  if (Object.keys(data).length === 0) {
    return jsonError("UNPROCESSABLE", "inAppEnabled 與 externalEnabled 至少要提供一個布林值");
  }

  const defaults = getEventTypeDefaults(eventType);
  const pref = await db.notificationPreference.upsert({
    where: { userId_eventType: { userId: user.id, eventType } },
    update: data,
    create: {
      userId: user.id,
      eventType,
      inAppEnabled: data.inAppEnabled ?? defaults.defaultInAppEnabled,
      externalEnabled: data.externalEnabled ?? defaults.defaultExternalEnabled,
    },
    select: { eventType: true, inAppEnabled: true, externalEnabled: true },
  });

  return NextResponse.json(pref);
}
