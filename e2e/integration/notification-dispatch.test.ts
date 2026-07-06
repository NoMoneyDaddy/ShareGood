import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 外部發送涉及網路呼叫，測試裡一律 mock 掉：sendTelegramMessage 用 vi.fn 記錄呼叫、
// 預設回成功；web push 直接讓 sendWebPushToUser 回 attempted:false（本管線的 P0 是
// Telegram，web push 不是這批測試的斷言重點，讓它成為 no-op 即可，不需要 VAPID／裝置）。
vi.mock("@/lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram")>();
  return { ...actual, sendTelegramMessage: vi.fn(async () => ({ ok: true as const })) };
});
vi.mock("@/lib/web-push", () => ({
  sendWebPushToUser: vi.fn(async () => ({ attempted: false, anySuccess: false })),
}));

import { dispatchPendingNotifications } from "@/lib/notification-dispatch";
import { DAILY_EXTERNAL_NOTIFICATION_LIMIT } from "@/lib/notifications";
import { sendTelegramMessage } from "@/lib/telegram";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

const sendMock = sendTelegramMessage as unknown as ReturnType<typeof vi.fn>;

// 掃描下界固定拉到 1 小時前，涵蓋測試當下建立的通知。
function since(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

/** 這次執行中 sendTelegramMessage 是否對某 chatId 送過。 */
function calledWithChat(chatId: string): boolean {
  return sendMock.mock.calls.some((call) => call[0] === chatId);
}

async function makeNotification(userId: string, type = "claim_accepted") {
  return db.notification.create({
    data: {
      userId,
      type: type as never,
      payload: { itemId: `dispatch-item-${userId}`, itemTitle: "測試物品" },
    },
  });
}

describe("外部通知初次發送管線（補 M4 遺留缺口）", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    sendMock.mockClear();
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function activeAccount(userId: string, chatId: string) {
    await db.telegramAccount.create({
      data: { userId, telegramChatId: chatId, isActive: true },
    });
  }

  it("已綁定 active 帳號＋外部通知預設開：真的送出並記一筆 sent delivery", async () => {
    const u = await user("dispatch-happy");
    const chatId = `chat-happy-${u.id}`;
    await activeAccount(u.id, chatId);
    const notification = await makeNotification(u.id);

    const summary = await dispatchPendingNotifications({ since: since() });

    expect(calledWithChat(chatId)).toBe(true);
    expect(summary.telegramSent).toBeGreaterThanOrEqual(1);
    const delivery = await db.notificationDelivery.findUnique({
      where: {
        notificationId_channel: { notificationId: notification.id, channel: "telegram" },
      },
    });
    expect(delivery?.status).toBe("sent");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.sentAt).not.toBeNull();
  });

  it("偏好把該事件外部通知關掉：不送、不建立任何 delivery", async () => {
    const u = await user("dispatch-pref-off");
    const chatId = `chat-pref-${u.id}`;
    await activeAccount(u.id, chatId);
    // claim_accepted 的外部通知預設是開的，這裡明確關掉。
    await db.notificationPreference.create({
      data: {
        userId: u.id,
        eventType: "claim_accepted",
        inAppEnabled: true,
        externalEnabled: false,
      },
    });
    const notification = await makeNotification(u.id);

    await dispatchPendingNotifications({ since: since() });

    expect(calledWithChat(chatId)).toBe(false);
    const delivery = await db.notificationDelivery.findUnique({
      where: {
        notificationId_channel: { notificationId: notification.id, channel: "telegram" },
      },
    });
    expect(delivery).toBeNull();
  });

  it("Telegram 帳號未綁定或 inactive：不送、不建立 delivery", async () => {
    const u = await user("dispatch-inactive");
    const chatId = `chat-inactive-${u.id}`;
    await db.telegramAccount.create({
      data: { userId: u.id, telegramChatId: chatId, isActive: false },
    });
    const notification = await makeNotification(u.id);

    const summary = await dispatchPendingNotifications({ since: since() });

    expect(calledWithChat(chatId)).toBe(false);
    expect(summary.telegramSkippedNoAccount).toBeGreaterThanOrEqual(1);
    const delivery = await db.notificationDelivery.findUnique({
      where: {
        notificationId_channel: { notificationId: notification.id, channel: "telegram" },
      },
    });
    expect(delivery).toBeNull();
  });

  it("已達每日外部通知上限：不再送、不建立新 delivery", async () => {
    const u = await user("dispatch-daily-limit");
    const chatId = `chat-limit-${u.id}`;
    await activeAccount(u.id, chatId);

    // 先塞滿今天的額度：建立上限筆數的 sent telegram delivery（各自掛一則通知）。
    for (let i = 0; i < DAILY_EXTERNAL_NOTIFICATION_LIMIT; i++) {
      const n = await makeNotification(u.id);
      await db.notificationDelivery.create({
        data: {
          notificationId: n.id,
          channel: "telegram",
          status: "sent",
          attempts: 1,
          sentAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });
    }
    // 第 (上限+1) 則：應被每日上限擋下。
    const overflow = await makeNotification(u.id);

    const summary = await dispatchPendingNotifications({ since: since() });

    expect(calledWithChat(chatId)).toBe(false);
    expect(summary.telegramSkippedDailyLimit).toBeGreaterThanOrEqual(1);
    const delivery = await db.notificationDelivery.findUnique({
      where: {
        notificationId_channel: { notificationId: overflow.id, channel: "telegram" },
      },
    });
    expect(delivery).toBeNull();
  });

  it("job 重複執行：同一則通知不重複發送（靠 unique(notificationId, channel) 防重）", async () => {
    const u = await user("dispatch-idempotent");
    const chatId = `chat-idem-${u.id}`;
    await activeAccount(u.id, chatId);
    const notification = await makeNotification(u.id);

    await dispatchPendingNotifications({ since: since() });
    const callsAfterFirst = sendMock.mock.calls.filter((c) => c[0] === chatId).length;

    await dispatchPendingNotifications({ since: since() });
    const callsAfterSecond = sendMock.mock.calls.filter((c) => c[0] === chatId).length;

    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1); // 第二次不再送

    const deliveries = await db.notificationDelivery.findMany({
      where: { notificationId: notification.id, channel: "telegram" },
    });
    expect(deliveries).toHaveLength(1);
  });

  it("送出失敗：留下 failed delivery + lastError，供 M8 重送 job 接手", async () => {
    const u = await user("dispatch-fail");
    const chatId = `chat-fail-${u.id}`;
    await activeAccount(u.id, chatId);
    const notification = await makeNotification(u.id);

    sendMock.mockImplementationOnce(async () => ({
      ok: false as const,
      error: "模擬送出失敗",
      deactivated: false,
    }));

    await dispatchPendingNotifications({ since: since() });

    const delivery = await db.notificationDelivery.findUnique({
      where: {
        notificationId_channel: { notificationId: notification.id, channel: "telegram" },
      },
    });
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.lastError).toBe("模擬送出失敗");
  });
});
