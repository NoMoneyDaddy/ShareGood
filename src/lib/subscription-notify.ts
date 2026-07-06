import type { NotificationType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getEventTypeDefaults } from "@/lib/notification-preferences";
import { createOrMergeNotification, shouldSendExternalNotification } from "@/lib/notifications";
import { sendWebPushToUser, type WebPushPayload } from "@/lib/web-push";

// M6 訂閱通知（master-plan §6a 交付內容 2、6）：把「訂閱比對/摘要 job」跟「M4 通知偏好＋
// Web Push 外部派送」的整合邏輯集中在這裡，讓 subscription-match-scan 與
// subscription-daily-digest 兩支 job 共用同一套規則。
//
// NotificationType enum 沒有專屬的 subscription_match/subscription_digest 類型（維持
// prisma/schema.prisma 不動，這是本次任務明確限制）；沿用 src/app/api/jobs/item-expiration
// /route.ts 已經立下的既定做法——重用 completion_confirmed type，在 payload 帶 kind 欄位
// 當判別依據，UI 端（src/app/notifications/page.tsx）已經有處理不同 kind 的先例。
export const SUBSCRIPTION_NOTIFICATION_TYPE: NotificationType = "completion_confirmed";

export type SubscriptionEventType = "subscription_match" | "subscription_digest";

type PrefLookupClient = {
  notificationPreference: Pick<Prisma.NotificationPreferenceDelegate, "findUnique">;
};

async function resolvePreference(
  client: PrefLookupClient,
  userId: string,
  eventType: SubscriptionEventType,
) {
  const row = await client.notificationPreference.findUnique({
    where: { userId_eventType: { userId, eventType } },
    select: { inAppEnabled: true, externalEnabled: true },
  });
  const defaults = getEventTypeDefaults(eventType);
  return {
    inAppEnabled: row?.inAppEnabled ?? defaults.defaultInAppEnabled,
    externalEnabled: row?.externalEnabled ?? defaults.defaultExternalEnabled,
  };
}

type NotifyClient = PrefLookupClient & {
  notification: Pick<Prisma.NotificationDelegate, "findFirst" | "update" | "create">;
};

export type SubscriptionNotificationOutcome = {
  notificationId: string;
  externalEnabled: boolean;
};

/**
 * 在 transaction 內：查 M4 通知偏好，`inAppEnabled` 才建立/合併站內通知；`inAppEnabled=false`
 * 時完全不建立 `Notification`，回傳 null。
 *
 * 這跟訂閱本身的 `immediateEnabled`/`dailyDigestEnabled`（決定「時機」）是正交的兩層閘門
 * （master-plan §6a 交付內容 2）：呼叫端仍應該照原本的時機邏輯蓋章
 * `SubscriptionMatch.notifiedAt`/`notifiedVia`，不因為這裡沒建立通知就跳過蓋章——「比對命中
 * 這件事已經處理過」跟「有沒有實際通知到使用者」是两回事。
 */
export async function createSubscriptionNotificationIfEnabled(
  tx: NotifyClient,
  params: {
    userId: string;
    eventType: SubscriptionEventType;
    payload: Prisma.InputJsonObject;
  },
): Promise<SubscriptionNotificationOutcome | null> {
  const pref = await resolvePreference(tx, params.userId, params.eventType);
  if (!pref.inAppEnabled) return null;

  const notification = await createOrMergeNotification(tx, {
    userId: params.userId,
    type: SUBSCRIPTION_NOTIFICATION_TYPE,
    payload: params.payload,
  });
  return { notificationId: notification.id, externalEnabled: pref.externalEnabled };
}

/**
 * Transaction 之外呼叫：真的嘗試 Web Push 派送（網路呼叫不該卡在 DB transaction 裡）。
 *
 * - `externalEnabled=false`：使用者把這個事件類型的外部通知關掉，不嘗試、不留紀錄
 *   （master-plan §6a 驗收清單：「仍有站內通知，但不嘗試 Telegram/Web Push 派送，
 *   notification_deliveries 不新增該筆的外部管道紀錄」）。
 * - 每人每日外部通知上限（M4 `shouldSendExternalNotification`）：額度用完直接跳過，不留紀錄
 *   （限制不生效不算失敗，跟「使用者關掉外部通知」同樣不留痕跡）。
 * - 使用者名下沒有任何 `isActive=true` 的裝置：`sendWebPushToUser` 回傳 `attempted=false`，
 *   同樣不留紀錄（比照「沒綁定 Telegram 就跳過 Telegram 管道」）。
 * - 其餘情況（真的嘗試過）：`notification_deliveries` 寫一筆 `channel='web_push'`，
 *   任一裝置成功即 `status='sent'`，全部失敗才是 `status='failed'`。
 */
export async function dispatchWebPushForNotification(params: {
  userId: string;
  notificationId: string;
  externalEnabled: boolean;
  pushPayload: WebPushPayload;
}): Promise<void> {
  if (!params.externalEnabled) return;

  const allowed = await shouldSendExternalNotification(params.userId);
  if (!allowed) return;

  const result = await sendWebPushToUser(params.userId, params.pushPayload);
  if (!result.attempted) return;

  const now = new Date();
  await db.notificationDelivery.upsert({
    where: {
      notificationId_channel: { notificationId: params.notificationId, channel: "web_push" },
    },
    create: {
      notificationId: params.notificationId,
      channel: "web_push",
      status: result.anySuccess ? "sent" : "failed",
      attempts: 1,
      lastAttemptAt: now,
      sentAt: result.anySuccess ? now : null,
    },
    update: {
      status: result.anySuccess ? "sent" : "failed",
      attempts: { increment: 1 },
      lastAttemptAt: now,
      ...(result.anySuccess ? { sentAt: now } : {}),
    },
  });
}
