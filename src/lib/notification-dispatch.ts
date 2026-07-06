import type { NotificationType } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { formatNotificationText } from "@/lib/notification-format";
import {
  getEventTypeDefaults,
  isNotificationEventType,
  type NotificationEventType,
} from "@/lib/notification-preferences";
import { shouldSendExternalNotification } from "@/lib/notifications";
import { dispatchWebPushForNotification } from "@/lib/subscription-notify";
import { sendTelegramMessage } from "@/lib/telegram";

// ==========================================================================
// M4 遺留缺口補完：外部通知「初次發送」管線（outbox 掃描）。
//
// 背景：M4 綁定 Telegram 成功時 bot 回覆「之後有新通知我會傳到這裡」，但初次發送管線
// 從來沒有存在——沒有任何程式碼會為業務事件建立 telegram 的 NotificationDelivery 或呼叫
// sendTelegramMessage。M8 的 src/lib/notification-retry.ts 只重試「已存在的 failed
// delivery」，前提是那些 delivery 要先被建立出來。本檔補上那個前提。
//
// 架構選擇：outbox 式掃描 job（沿用 M3/M8 的 system_jobs／CRON_SECRET 模式），而不是在
// 每個業務端點 commit 後各自呼叫 dispatch。理由：
// 1. 本專案硬規則「不動已驗證過的既有原子分支」——留言／認領／直贈／交接／抽籤／到期 job
//    這些寫入通知的地方都已經過併發與 idempotency 測試，逐一去改風險高、收益低。
// 2. 外部發送涉及網路呼叫，絕不能發生在資料庫 transaction 內。outbox 天生把「建立站內
//    通知（在 tx 內）」與「外送（在 tx 外，由 job 掃描）」解耦。
// 3. 防重複發送直接靠既有 schema 的 @@unique([notificationId, channel])：一則站內通知在
//    telegram 管道最多只會有一筆 delivery，重複觸發／多 worker 併發時，搶不到那筆 create
//    的請求會撞 P2002 而跳過，天然 idempotent（不需要新增任何 schema）。
//
// 掃描範圍下界：只看最近 DISPATCH_LOOKBACK_HOURS 小時內建立、且尚無 telegram delivery 的
// 通知（route 端另有「首次執行 watermark」避免上線瞬間把 24h 內的歷史通知一次轟出，見
// src/app/api/jobs/notification-dispatch/route.ts）。
// ==========================================================================

/** 掃描下界：只處理最近這麼多小時內建立的通知（避免無限回溯歷史）。 */
export const DISPATCH_LOOKBACK_HOURS = 24;
/** 單次執行最多處理幾則通知，避免單一 request 執行過久；剩餘留給下次觸發繼續。 */
export const DISPATCH_BATCH_LIMIT = 200;

export interface NotificationDispatchSummary {
  scanned: number;
  telegramSent: number;
  telegramFailed: number;
  telegramSkippedNoAccount: number;
  telegramSkippedPreference: number;
  telegramSkippedDailyLimit: number;
  telegramSkippedDuplicate: number;
  webPushDispatched: number;
  errors: number;
}

/** payload.kind 屬於 M6 訂閱事件（web push 已由 M6 inline 派送，outbox 不重複送 web push）。 */
export function isSubscriptionKind(kind: unknown): boolean {
  return kind === "subscription_match" || kind === "subscription_digest";
}

/**
 * 把「站內通知的 NotificationType + payload.kind」對應回 notification_preferences 的
 * eventType（偏好查詢用）。全站沿用「重用少數 enum 值 + payload.kind 判別」的既定做法，
 * 所以要先看 kind（到期／訂閱），再 fallback 回 NotificationType enum。lottery_* 與
 * item_force_removed 沒有專屬偏好項目，落回它們實際借用的 type（completion_confirmed／
 * handover_message）的偏好設定。
 */
export function resolveExternalEventType(
  type: NotificationType,
  kind: unknown,
): NotificationEventType {
  if (kind === "item_expired" || kind === "item_expiring_reminder") return "expiring_soon";
  if (kind === "subscription_match") return "subscription_match";
  if (kind === "subscription_digest") return "subscription_digest";
  // 其餘（含 lottery_*、item_force_removed）：用實際的 NotificationType enum 值當偏好 key。
  // NotificationType 的 5 個值剛好都是合法的 eventType（見 notification-preferences 目錄）。
  return isNotificationEventType(type) ? type : "completion_confirmed";
}

async function resolveExternalEnabled(
  userId: string,
  eventType: NotificationEventType,
): Promise<boolean> {
  const row = await db.notificationPreference.findUnique({
    where: { userId_eventType: { userId, eventType } },
    select: { externalEnabled: true },
  });
  return row?.externalEnabled ?? getEventTypeDefaults(eventType).defaultExternalEnabled;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * 掃描「最近 since 之後建立、尚無 telegram delivery」的通知，逐則做：偏好檢查 →
 * 每日外部上限 → 原子搶佔建立 delivery → 呼叫 sendTelegramMessage → 更新 delivery
 * 狀態。非訂閱事件同場加映 Web Push（重用既有 dispatchWebPushForNotification；訂閱事件的
 * web push 已由 M6 inline 送過，這裡刻意不碰，避免兩個 producer 對同一通知重複推播）。
 *
 * 錯誤隔離：單則通知處理出錯（非預期例外）只記 errors 計數並跳過，不中斷整個 batch——
 * 比照 subscription-match-scan 的既有做法，避免一筆壞資料卡死整條外送管線。
 *
 * @param since 掃描下界（通知的 createdAt 必須 >= 這個時間）。由呼叫端（job route）依
 *   lookback 與首次執行 watermark 算出。
 */
export async function dispatchPendingNotifications(params: {
  since: Date;
  batchLimit?: number;
}): Promise<NotificationDispatchSummary> {
  const batchLimit = params.batchLimit ?? DISPATCH_BATCH_LIMIT;

  const summary: NotificationDispatchSummary = {
    scanned: 0,
    telegramSent: 0,
    telegramFailed: 0,
    telegramSkippedNoAccount: 0,
    telegramSkippedPreference: 0,
    telegramSkippedDailyLimit: 0,
    telegramSkippedDuplicate: 0,
    webPushDispatched: 0,
    errors: 0,
  };

  // 主掃描鎖定「還沒有 telegram delivery」的通知——telegram 是本管線的 P0 目標，也是唯一
  // producer，所以用它當「尚未派送」的判準最直接。deliveries.none 讓已經送過（不論成敗）
  // 的通知不會被重掃。
  const pending = await db.notification.findMany({
    where: {
      createdAt: { gte: params.since },
      deliveries: { none: { channel: "telegram" } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchLimit,
    select: { id: true, userId: true, type: true, payload: true },
  });
  summary.scanned = pending.length;

  for (const notification of pending) {
    try {
      const kind = payloadRecord(notification.payload).kind;
      const eventType = resolveExternalEventType(notification.type, kind);
      const externalEnabled = await resolveExternalEnabled(notification.userId, eventType);

      // 使用者把這個事件類型的外部通知關掉：不嘗試、不留任何 delivery 紀錄（比照
      // M6 dispatchWebPushForNotification 的既定語意）。
      if (!externalEnabled) {
        summary.telegramSkippedPreference++;
        continue;
      }

      await dispatchTelegram(notification, summary);
      await dispatchWebPush(notification, kind, summary);
    } catch (e) {
      summary.errors++;
      console.error(`[notification-dispatch] 處理通知失敗 notificationId=${notification.id}:`, e);
    }
  }

  return summary;
}

async function dispatchTelegram(
  notification: { id: string; userId: string; type: NotificationType; payload: unknown },
  summary: NotificationDispatchSummary,
): Promise<void> {
  const account = await db.telegramAccount.findUnique({ where: { userId: notification.userId } });
  // 沒綁定或已停用：沒有可送達的管道，跳過、不建立 failed delivery（否則重送 job 會一直
  // 白跑；比照「沒綁 Telegram 就跳過」的既有精神）。
  if (!account?.isActive) {
    summary.telegramSkippedNoAccount++;
    return;
  }

  // 每人每日外部通知上限（M4 shouldSendExternalNotification）：額度用完直接跳過，不留紀錄
  // （限制不生效不算失敗）。在建立 delivery 之前檢查，避免把當次的 pending 列算進自己。
  const allowed = await shouldSendExternalNotification(notification.userId);
  if (!allowed) {
    summary.telegramSkippedDailyLimit++;
    return;
  }

  // 原子搶佔：先建立 pending delivery。@@unique([notificationId, channel]) 讓併發／重複
  // 觸發時只有一個請求能建立成功，其餘撞 P2002 直接跳過，天然防重複發送。
  const now = new Date();
  let deliveryId: string;
  try {
    const delivery = await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "telegram",
        status: "pending",
        attempts: 0,
      },
      select: { id: true },
    });
    deliveryId = delivery.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      summary.telegramSkippedDuplicate++;
      return;
    }
    throw e;
  }

  const text = formatNotificationText(notification.type, notification.payload);

  // 發送與狀態更新包在同一個 try/catch：delivery 這時已經是 pending，若發送本身
  // （sendTelegramMessage 例外，而非它回傳的 {ok:false}）或後續的狀態更新意外拋錯而不攔截，
  // 這筆 delivery 會永遠卡在 pending——M8 的 notification-retry job 只會撿 status=failed
  // 的 delivery，pending 永遠不會被重試機制看到。
  try {
    const result = await sendTelegramMessage(account.telegramChatId, text);

    if (result.ok) {
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "sent", attempts: 1, lastAttemptAt: now, sentAt: now, lastError: null },
      });
      summary.telegramSent++;
    } else {
      // 標記 failed 並留 lastError／attempts=1／lastAttemptAt——M8 的 notification-retry job
      // 會依指數退避在之後把它撿起來重試（初次發送與重試就此無縫接上）。
      await db.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "failed", attempts: 1, lastAttemptAt: now, lastError: result.error },
      });
      summary.telegramFailed++;
    }
  } catch (e) {
    // 未預期錯誤（網路例外、DB 例外等，不是 sendTelegramMessage 正常回傳的失敗）：盡力把
    // delivery 標成 failed，讓 M8 重試機制能接手。比照 system-jobs.ts 的既定模式——這個
    // 「標成 failed」的 update 本身若又失敗（例如 DB 斷線），不能讓它蓋掉或吞掉原始錯誤，
    // 只用 .catch(console.error) 留痕跡，原始錯誤照樣往外拋給外層
    // dispatchPendingNotifications 的 per-notification try/catch（記 errors 計數、不中斷
    // 整個 batch）。
    db.notificationDelivery
      .update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          attempts: 1,
          lastAttemptAt: now,
          lastError: e instanceof Error ? e.message : String(e),
        },
      })
      .catch((updateError) => {
        console.error(
          `dispatchTelegram: 標記 delivery（id=${deliveryId}）failed 狀態時發生錯誤，原始錯誤仍會照常往外拋`,
          updateError,
        );
      });
    throw e;
  }
}

async function dispatchWebPush(
  notification: { id: string; userId: string; type: NotificationType; payload: unknown },
  kind: unknown,
  summary: NotificationDispatchSummary,
): Promise<void> {
  // 訂閱事件（subscription_match／digest）的 web push 已由 M6 inline 送過，outbox 不重複
  // 派送這兩類，避免同一通知被兩個 producer 各推一次。核心 5 種事件（留言／認領／直贈／
  // 交接／完成）與 M2/M3/M5 借用 completion_confirmed 的事件則由這裡補上 web push，讓 M6
  // 的裝置訂閱對核心事件也生效。
  if (isSubscriptionKind(kind)) return;

  // 已經有 web_push delivery（例如上一輪 outbox 已送過）就不重複送。outbox 是這些事件
  // web push 的唯一 producer，正常情況下不會有既有紀錄；這個檢查主要防同一則通知在極短
  // 時間內被兩輪 job 併發處理。
  //
  // 已知取捨：這個 findUnique 存在性檢查本身不是原子的（check-then-act），兩輪 job 真的
  // 併發時理論上都會通過檢查、各自呼叫下面的 dispatchWebPushForNotification。但這不會
  // 造成資料錯亂——dispatchWebPushForNotification 內部用 upsert（by @@unique
  // ([notificationId, channel])）寫入，第二次呼叫只是把同一筆紀錄 update 一次，不會撞
  // P2002 也不會產生兩筆紀錄。唯一殘留風險是使用者裝置端可能收到兩次實際的瀏覽器推播，
  // 屬低風險（而且前提是本來就已知、暫不處理的「job route 可併發多個 running run」情境
  // 才會發生），故先不修，只留這段紀錄。
  const existing = await db.notificationDelivery.findUnique({
    where: { notificationId_channel: { notificationId: notification.id, channel: "web_push" } },
    select: { id: true },
  });
  if (existing) return;

  const p = payloadRecord(notification.payload);
  const itemId = typeof p.itemId === "string" && p.itemId ? p.itemId : null;
  // web push 的 body 不需要「【好物共享】」前綴（title 已表明來源），借用同一份文字產生器
  // 後把前綴去掉。
  const body = formatNotificationText(notification.type, notification.payload).replace(
    /^【好物共享】/,
    "",
  );

  await dispatchWebPushForNotification({
    userId: notification.userId,
    notificationId: notification.id,
    externalEnabled: true, // 已在呼叫端確認 externalEnabled=true 才會走到這裡
    pushPayload: {
      title: "好物共享",
      body,
      itemUrl: itemId ? `/items/${itemId}` : "/notifications",
    },
  });
  summary.webPushDispatched++;
}
