import { afterAll, describe, expect, it } from "vitest";
import { processNotificationRetry } from "@/lib/notification-retry";
import { NOTIFICATION_MAX_ATTEMPTS, notificationBackoffSeconds } from "@/lib/ops-config";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// master-plan §8a 驗收清單（交付內容 6）：
// 「通知重送：...對應 notification_deliveries 轉 failed、attempts+1；notification_retry
// job 依指數退避規則，在正確的時間窗口內才再次嘗試（提早觸發 job 驗證『還沒到重試時間，
// 不重試』；把 lastAttemptAt 人為撥到退避時間之前驗證『到時間了，重試』）；達到
// attempts>=5 後不再被重送 job 挑中」「連續 3 次失敗且錯誤訊息符合『帳號已失效』特徵的
// telegram_accounts，重送 job 執行後 isActive 轉 false 且 unlinkedAt 有值」。
//
// 本機沒有真的 TELEGRAM_BOT_TOKEN（見 src/lib/telegram.ts 既有說明），所以每次
// `sendTelegramMessage` 真的被呼叫時都會走進「TELEGRAM_BOT_TOKEN 未設定」這個確定性的
// 失敗分支——這剛好讓「有沒有真的觸發重試」這件事可以用 attempts/lastError 是否改變來
// 驗證，不需要真的 Telegram 服務。
async function createNotificationWithDelivery(opts: {
  userId: string;
  attempts: number;
  lastAttemptAt: Date | null;
  lastError?: string | null;
}) {
  const notification = await db.notification.create({
    data: {
      userId: opts.userId,
      type: "new_comment",
      payload: { itemId: "fake-item", itemTitle: "測試物品" },
    },
  });
  const delivery = await db.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      channel: "telegram",
      status: "failed",
      attempts: opts.attempts,
      lastAttemptAt: opts.lastAttemptAt,
      lastError: opts.lastError ?? "模擬的失敗原因",
    },
  });
  return { notification, delivery };
}

describe("M8 通知失敗指數退避重送", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("退避時間還沒到：不重試（attempts／lastAttemptAt 不變）", async () => {
    const owner = await user("notif-retry-not-due");
    // attempts=1 的退避秒數是 min(2^1*60, 3600) = 120 秒；30 秒前嘗試過，還沒到重試時機。
    const lastAttemptAt = new Date(Date.now() - 30 * 1000);
    const { delivery } = await createNotificationWithDelivery({
      userId: owner.id,
      attempts: 1,
      lastAttemptAt,
    });

    await processNotificationRetry();

    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.attempts).toBe(1);
    expect(after.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
  });

  it("退避時間已到：真的重試（沒有綁定 Telegram 帳號，attempts 直接推到上限並停止重試）", async () => {
    const owner = await user("notif-retry-due-no-account");
    // attempts=1 的退避秒數是 120 秒，撥到 200 秒前，早就過了退避時間。
    const lastAttemptAt = new Date(Date.now() - 200 * 1000);
    const { delivery } = await createNotificationWithDelivery({
      userId: owner.id,
      attempts: 1,
      lastAttemptAt,
    });

    await processNotificationRetry();

    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    // 這個使用者沒有綁定 TelegramAccount：重試邏輯判定「不會有真的 API 呼叫可以重試」，
    // 直接把 attempts 推到上限，停止之後被挑中（見 src/lib/notification-retry.ts）。
    expect(after.attempts).toBe(NOTIFICATION_MAX_ATTEMPTS);
    expect(after.lastError).toContain("未綁定或已停用");
    expect(after.lastAttemptAt?.getTime()).toBeGreaterThan(lastAttemptAt.getTime());
  });

  it("已綁定 Telegram 帳號、退避時間已到：真的呼叫 sendTelegramMessage，attempts+1、lastError 更新", async () => {
    const owner = await user("notif-retry-due-with-account");
    await db.telegramAccount.create({
      data: { userId: owner.id, telegramChatId: `retry-test-${owner.id}`, isActive: true },
    });
    const lastAttemptAt = new Date(Date.now() - 200 * 1000);
    const { delivery } = await createNotificationWithDelivery({
      userId: owner.id,
      attempts: 1,
      lastAttemptAt,
    });

    await processNotificationRetry();

    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.attempts).toBe(2); // 真的重試了一次
    expect(after.status).toBe("failed"); // 本機沒有真的 TELEGRAM_BOT_TOKEN，一定會失敗
    expect(after.lastError).toBe("TELEGRAM_BOT_TOKEN 未設定");
    expect(after.lastAttemptAt?.getTime()).toBeGreaterThan(lastAttemptAt.getTime());
  });

  it("attempts 已達上限：不再被重送 job 挑中", async () => {
    const owner = await user("notif-retry-maxed");
    await db.telegramAccount.create({
      data: { userId: owner.id, telegramChatId: `retry-maxed-${owner.id}`, isActive: true },
    });
    const lastAttemptAt = new Date(Date.now() - 999_999_999); // 遠早於任何退避窗口
    const { delivery } = await createNotificationWithDelivery({
      userId: owner.id,
      attempts: NOTIFICATION_MAX_ATTEMPTS,
      lastAttemptAt,
    });

    await processNotificationRetry();

    const after = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.attempts).toBe(NOTIFICATION_MAX_ATTEMPTS); // 沒被動到
    expect(after.lastAttemptAt?.getTime()).toBe(lastAttemptAt.getTime());
  });

  it("指數退避秒數公式：min(2^N × 60, 3600)", () => {
    expect(notificationBackoffSeconds(1)).toBe(120);
    expect(notificationBackoffSeconds(2)).toBe(240);
    expect(notificationBackoffSeconds(3)).toBe(480);
    expect(notificationBackoffSeconds(10)).toBe(3600); // 封頂 1 小時
  });

  it("連續 3 次失敗且符合『帳號已失效』特徵：telegram 帳號自動解綁", async () => {
    const owner = await user("notif-retry-deactivate");
    const account = await db.telegramAccount.create({
      data: { userId: owner.id, telegramChatId: `deactivate-test-${owner.id}`, isActive: true },
    });

    // 連續 3 筆都是 failed 且錯誤訊息符合 DEACTIVATE_ON_ERROR_PATTERNS
    // （見 src/lib/telegram.ts）：這裡用 "blocked" 特徵字串。attempts 故意設到上限，
    // 確定不會被「重試」那段邏輯處理到，只驗證獨立的「連續失敗解綁」掃描。
    for (let i = 0; i < 3; i++) {
      await createNotificationWithDelivery({
        userId: owner.id,
        attempts: NOTIFICATION_MAX_ATTEMPTS,
        lastAttemptAt: new Date(),
        lastError: "Forbidden: bot was blocked by the user",
      });
    }

    await processNotificationRetry();

    const after = await db.telegramAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.isActive).toBe(false);
    expect(after.unlinkedAt).not.toBeNull();
  });

  it("只有 2 次符合特徵、1 次不符合：不解綁", async () => {
    const owner = await user("notif-retry-no-deactivate");
    const account = await db.telegramAccount.create({
      data: { userId: owner.id, telegramChatId: `no-deactivate-test-${owner.id}`, isActive: true },
    });

    await createNotificationWithDelivery({
      userId: owner.id,
      attempts: NOTIFICATION_MAX_ATTEMPTS,
      lastAttemptAt: new Date(),
      lastError: "Forbidden: bot was blocked by the user",
    });
    await createNotificationWithDelivery({
      userId: owner.id,
      attempts: NOTIFICATION_MAX_ATTEMPTS,
      lastAttemptAt: new Date(),
      lastError: "Forbidden: bot was blocked by the user",
    });
    await createNotificationWithDelivery({
      userId: owner.id,
      attempts: NOTIFICATION_MAX_ATTEMPTS,
      lastAttemptAt: new Date(),
      lastError: "暫時性網路逾時，跟帳號失效無關",
    });

    await processNotificationRetry();

    const after = await db.telegramAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.isActive).toBe(true);
    expect(after.unlinkedAt).toBeNull();
  });
});
