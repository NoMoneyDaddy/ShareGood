import { db } from "@/lib/db";
import { formatNotificationText } from "@/lib/notification-format";
import {
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_RETRY_BATCH_LIMIT,
  notificationBackoffSeconds,
  TELEGRAM_CONSECUTIVE_FAILURES_FOR_DEACTIVATION,
} from "@/lib/ops-config";
import { DEACTIVATE_ON_ERROR_PATTERNS, sendTelegramMessage } from "@/lib/telegram";

// master-plan §8a 交付內容 6：通知失敗指數退避重送。

export interface NotificationRetrySummary {
  checked: number;
  dueForRetry: number;
  sent: number;
  failed: number;
  skippedInactiveAccount: number;
  deactivatedAccounts: number;
}

function isDueForRetry(
  delivery: { attempts: number; lastAttemptAt: Date | null },
  now: Date,
): boolean {
  if (!delivery.lastAttemptAt) return true; // failed 狀態理論上一定有 lastAttemptAt，沒有就保守視為可重試
  const backoffMs = notificationBackoffSeconds(delivery.attempts) * 1000;
  return now.getTime() - delivery.lastAttemptAt.getTime() >= backoffMs;
}

// 外部推播文字組裝已抽出到 src/lib/notification-format.ts 的 formatNotificationText
// （重送 job 與初次發送 job src/lib/notification-dispatch.ts 共用同一份，確保重試的
// failed delivery 也拿得到 kind 感知文字，例如抽籤／訂閱／到期事件，不會退回保底文案）。

/**
 * 規格明文要求的獨立判定：某個 `telegram_account` 最近連續 N 筆
 * （`TELEGRAM_CONSECUTIVE_FAILURES_FOR_DEACTIVATION`）delivery 都是 failed 且
 * `lastError` 符合「帳號已失效」特徵，就解綁（master-plan §8a 交付內容 6）。這是
 * `src/lib/telegram.ts` 既有「單次符合就立刻解綁」判斷的備援——兩者都是 idempotent 的
 * `updateMany({ where: { isActive: true } })`，重疊觸發不會出錯，故意保留這層重疊
 * （見 telegram.ts 的說明）。
 *
 * 刻意掃描「全站所有 `isActive: true` 帳號」而不是只查這批次 retry 迴圈實際碰過的
 * 使用者：曾經評估過把範圍限縮成這批次 touched 的 userId 清單以降低查詢量，但這樣會
 * 讓「delivery.attempts 已經到上限、不會再被上面 retry 候選查詢挑中」的帳號永遠沒有
 * 機會被這支獨立掃描檢查到——`e2e/integration/ops-notification-retry.test.ts`
 * 「連續 3 次失敗且符合『帳號已失效』特徵：telegram 帳號自動解綁」這個案例就是刻意把
 * attempts 設到上限來驗證這件事，限縮範圍會讓這個案例失敗（已實測驗證）。目前規模
 * （台灣縣市級平台，非全球量級）下這裡的 O(啟用中帳號數) 掃描可接受，先不犧牲正確性
 * 換效能；未來帳號規模真的大到需要優化時，應該改用一次性的 SQL 聚合查詢（例如用
 * window function 在資料庫端算出每個帳號最近 N 筆是否全部符合條件），而不是限縮掃描
 * 範圍。
 */
async function deactivateAccountsWithRepeatedFailures(): Promise<number> {
  const activeAccounts = await db.telegramAccount.findMany({ where: { isActive: true } });
  let deactivated = 0;

  for (const account of activeAccounts) {
    const recentDeliveries = await db.notificationDelivery.findMany({
      where: { channel: "telegram", notification: { userId: account.userId } },
      orderBy: { createdAt: "desc" },
      take: TELEGRAM_CONSECUTIVE_FAILURES_FOR_DEACTIVATION,
      select: { status: true, lastError: true },
    });

    if (recentDeliveries.length < TELEGRAM_CONSECUTIVE_FAILURES_FOR_DEACTIVATION) continue;

    const allMatchInvalidPattern = recentDeliveries.every(
      (d) =>
        d.status === "failed" &&
        !!d.lastError &&
        DEACTIVATE_ON_ERROR_PATTERNS.some((pattern) => pattern.test(d.lastError as string)),
    );
    if (!allMatchInvalidPattern) continue;

    const updated = await db.telegramAccount.updateMany({
      where: { id: account.id, isActive: true },
      data: { isActive: false, unlinkedAt: new Date() },
    });
    if (updated.count > 0) deactivated++;
  }

  return deactivated;
}

/**
 * 通知失敗指數退避重送：撈出 `attempts < 上限` 的 failed telegram deliveries，依
 * `lastAttemptAt` 加上退避秒數（`notificationBackoffSeconds`）判斷是否到重試時機，到了
 * 才真的呼叫 `sendTelegramMessage` 重試；執行完再跑一次「連續失敗解綁」掃描（見上）。
 *
 * `now` 參數預設真實時間，供測試傳入固定時間點以取得決定性結果（驗收清單要求「提早觸發
 * job 驗證還沒到重試時間不重試」／「把 lastAttemptAt 撥到退避時間之前驗證到時間了會重試」，
 * 兩種都可以透過直接操縱測試資料的 `lastAttemptAt` 達成，不一定要靠這個參數，但保留它
 * 讓測試更彈性）。
 */
export async function processNotificationRetry(
  now: Date = new Date(),
): Promise<NotificationRetrySummary> {
  const candidates = await db.notificationDelivery.findMany({
    where: { channel: "telegram", status: "failed", attempts: { lt: NOTIFICATION_MAX_ATTEMPTS } },
    orderBy: { lastAttemptAt: "asc" },
    take: NOTIFICATION_RETRY_BATCH_LIMIT,
    include: { notification: { select: { userId: true, type: true, payload: true } } },
  });

  let dueForRetry = 0;
  let sent = 0;
  let failed = 0;
  let skippedInactiveAccount = 0;

  for (const delivery of candidates) {
    if (!isDueForRetry(delivery, now)) continue;
    dueForRetry++;

    const account = await db.telegramAccount.findUnique({
      where: { userId: delivery.notification.userId },
    });
    const attemptedAt = new Date();

    if (!account?.isActive) {
      // 帳號未綁定或已停用：不會有真的 Telegram API 呼叫可以重試，直接把 attempts 推到
      // 上限讓它不再被下一輪候選查詢挑中，避免每輪都白跑一次注定失敗的檢查。
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          lastAttemptAt: attemptedAt,
          lastError: "Telegram 帳號未綁定或已停用，停止重試",
        },
      });
      skippedInactiveAccount++;
      continue;
    }

    const text = formatNotificationText(delivery.notification.type, delivery.notification.payload);
    const result = await sendTelegramMessage(account.telegramChatId, text);

    if (result.ok) {
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "sent", sentAt: attemptedAt, lastAttemptAt: attemptedAt, lastError: null },
      });
      sent++;
    } else {
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { attempts: { increment: 1 }, lastAttemptAt: attemptedAt, lastError: result.error },
      });
      failed++;
    }
  }

  const deactivatedAccounts = await deactivateAccountsWithRepeatedFailures();

  return {
    checked: candidates.length,
    dueForRetry,
    sent,
    failed,
    skippedInactiveAccount,
    deactivatedAccounts,
  };
}
