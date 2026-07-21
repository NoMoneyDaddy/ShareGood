import type { Prisma } from "@/generated/prisma/client";
import { getEventTypeDefaults } from "@/lib/notification-preferences";
import { createOrMergeNotification } from "@/lib/notifications";

// M12 交付內容 5（面交約定時間，docs/plan/m12-product-growth.md）：常數與共用邏輯集中放這裡，
// 讓 PATCH /api/handover/[id]/meetup 與 POST /api/jobs/handover-meetup-reminder 兩支端點共用。

/** 提前多久提醒（規格建議值：2 小時前，之後可調整）。 */
export const MEETUP_REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;
/** 約定時間最遠可以設定在幾天後（防呆用，非嚴格業務規則）。 */
export const MEETUP_MAX_ADVANCE_DAYS = 90;
/** 通知偏好目錄 key，同時也是 payload.kind 判別值（比照既有 M3/M5/M6 借用 enum 的做法）。 */
export const MEETUP_EVENT_TYPE = "handover_meetup_reminder" as const;

export type ScheduledAtParseResult =
  | { ok: true; value: Date | null }
  | { ok: false; message: string };

/**
 * 解析 PATCH /api/handover/[id]/meetup 的 `scheduledAt` 輸入：`null` 代表清空/取消約定
 * （合法輸入，直接放行）；字串須為合法 ISO 8601、晚於現在、且在 `MEETUP_MAX_ADVANCE_DAYS`
 * 天內，否則視為輸入錯誤（422）。
 */
export function parseScheduledAtInput(
  value: unknown,
  now: Date = new Date(),
): ScheduledAtParseResult {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, message: "約定時間格式不正確" };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "約定時間格式不正確" };
  }
  if (parsed.getTime() <= now.getTime()) {
    return { ok: false, message: "約定時間需晚於現在" };
  }
  const maxAdvanceMs = MEETUP_MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > now.getTime() + maxAdvanceMs) {
    return { ok: false, message: `約定時間需在 ${MEETUP_MAX_ADVANCE_DAYS} 天內` };
  }
  return { ok: true, value: parsed };
}

type NotifyClient = {
  notificationPreference: Pick<Prisma.NotificationPreferenceDelegate, "findUnique">;
  notification: Pick<Prisma.NotificationDelegate, "findFirst" | "update" | "create">;
};

/**
 * 面交提醒通知：先查 M4 通知偏好，`inAppEnabled` 才建立/合併站內通知；`inAppEnabled=false`
 * 完全不建立站內通知（M12 §0 共通決策 2：本章新事件一律採用 M6 `subscription-notify.ts`
 * 立下的「先查偏好才建立站內通知」模式，比 M1–M3 時期「直接寫入不查偏好」的舊做法嚴謹）。
 *
 * NotificationType enum 沒有專屬類型（維持 prisma/schema.prisma 不動，本次任務明確限制），
 * 沿用既有「重用 completion_confirmed type，payload.kind 判別」做法。
 */
export async function notifyMeetupReminderIfEnabled(
  tx: NotifyClient,
  params: { userId: string; itemId: string; itemTitle: string; scheduledAt: Date },
): Promise<void> {
  const row = await tx.notificationPreference.findUnique({
    where: { userId_eventType: { userId: params.userId, eventType: MEETUP_EVENT_TYPE } },
    select: { inAppEnabled: true },
  });
  const defaults = getEventTypeDefaults(MEETUP_EVENT_TYPE);
  const inAppEnabled = row?.inAppEnabled ?? defaults.defaultInAppEnabled;
  if (!inAppEnabled) return;

  await createOrMergeNotification(tx, {
    userId: params.userId,
    type: "completion_confirmed",
    payload: {
      itemId: params.itemId,
      itemTitle: params.itemTitle,
      kind: MEETUP_EVENT_TYPE,
      scheduledAt: params.scheduledAt.toISOString(),
    },
  });
}
