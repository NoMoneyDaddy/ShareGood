import { afterAll, describe, expect, it } from "vitest";
import {
  createOrMergeNotification,
  DAILY_EXTERNAL_NOTIFICATION_LIMIT,
  mergedCountOf,
  NOTIFICATION_MERGE_WINDOW_MINUTES,
  shouldSendExternalNotification,
} from "@/lib/notifications";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §9 驗收清單相關：「每日上限觸頂後停止外送但站內通知照常」
// 「30 分鐘窗口內同物品事件合併」。對應實作：src/lib/notifications.ts。
//
// 這支測試分兩塊：
// 1. 直接呼叫 createOrMergeNotification／shouldSendExternalNotification（跟六個既有
//    通知寫入點呼叫的是同一支函式），精確控制時間邊界與 payload，驗證合併視窗與每日
//    上限的每一條分支——用真的 Postgres 讀寫，不是 mock。
// 2. 透過真的 POST /api/conversations/[id]/messages 打兩次，驗證「wiring 本身」也正確
//    （不只是 helper 本身邏輯對，呼叫端真的有把合併效果串起來）。
describe("M4 通知合併（30 分鐘窗口）", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("同一使用者、同一物品、同一 type 的未讀通知在窗口內連續呼叫會合併成一筆", async () => {
    const user = await createTestUser({ label: "merge-basic" });
    userIds.push(user.id);
    const itemId = "fake-item-merge-basic"; // 這裡只測 helper 本身，不需要真的 Item 列

    const first = await createOrMergeNotification(db, {
      userId: user.id,
      type: "new_comment",
      payload: { itemId, itemTitle: "測試物品" },
    });
    expect(mergedCountOf(first.payload)).toBe(1);

    const second = await createOrMergeNotification(db, {
      userId: user.id,
      type: "new_comment",
      payload: { itemId, itemTitle: "測試物品" },
    });
    expect(second.id).toBe(first.id); // 合併進同一筆，不是新增
    expect(mergedCountOf(second.payload)).toBe(2);

    const third = await createOrMergeNotification(db, {
      userId: user.id,
      type: "new_comment",
      payload: { itemId, itemTitle: "測試物品" },
    });
    expect(third.id).toBe(first.id);
    expect(mergedCountOf(third.payload)).toBe(3);

    const rows = await db.notification.findMany({
      where: { userId: user.id, type: "new_comment" },
    });
    expect(rows).toHaveLength(1); // 三次呼叫，DB 裡仍然只有一筆
  });

  it("超過 30 分鐘窗口（含剛好卡在邊界外一分鐘）→ 另開新的一筆，不合併", async () => {
    const user = await createTestUser({ label: "merge-window" });
    userIds.push(user.id);
    const itemId = "fake-item-merge-window";

    const first = await createOrMergeNotification(db, {
      userId: user.id,
      type: "handover_message",
      payload: { itemId, itemTitle: "測試物品" },
    });

    // 把既有那筆的 createdAt 往回撥到「剛好超過視窗」：31 分鐘前。
    const staleCreatedAt = new Date(
      Date.now() - (NOTIFICATION_MERGE_WINDOW_MINUTES + 1) * 60 * 1000,
    );
    await db.notification.update({
      where: { id: first.id },
      data: { createdAt: staleCreatedAt },
    });

    const second = await createOrMergeNotification(db, {
      userId: user.id,
      type: "handover_message",
      payload: { itemId, itemTitle: "測試物品" },
    });

    expect(second.id).not.toBe(first.id); // 沒有合併，是新的一筆
    expect(mergedCountOf(second.payload)).toBe(1);

    const rows = await db.notification.findMany({
      where: { userId: user.id, type: "handover_message" },
    });
    expect(rows).toHaveLength(2);
  });

  it("已讀的通知不會被合併——即使還在 30 分鐘窗口內，也會另開新的一筆", async () => {
    const user = await createTestUser({ label: "merge-read" });
    userIds.push(user.id);
    const itemId = "fake-item-merge-read";

    const first = await createOrMergeNotification(db, {
      userId: user.id,
      type: "claim_accepted",
      payload: { itemId, itemTitle: "測試物品" },
    });
    await db.notification.update({ where: { id: first.id }, data: { readAt: new Date() } });

    const second = await createOrMergeNotification(db, {
      userId: user.id,
      type: "claim_accepted",
      payload: { itemId, itemTitle: "測試物品" },
    });

    expect(second.id).not.toBe(first.id);
    expect(mergedCountOf(second.payload)).toBe(1);
  });

  it("不同物品（不同 itemId）不會互相合併", async () => {
    const user = await createTestUser({ label: "merge-diff-item" });
    userIds.push(user.id);

    const a = await createOrMergeNotification(db, {
      userId: user.id,
      type: "new_comment",
      payload: { itemId: "fake-item-a", itemTitle: "物品 A" },
    });
    const b = await createOrMergeNotification(db, {
      userId: user.id,
      type: "new_comment",
      payload: { itemId: "fake-item-b", itemTitle: "物品 B" },
    });

    expect(a.id).not.toBe(b.id);
  });

  it("payload 沒有 itemId 就不比對合併，永遠新增一筆", async () => {
    const user = await createTestUser({ label: "merge-no-item" });
    userIds.push(user.id);

    const a = await createOrMergeNotification(db, {
      userId: user.id,
      type: "completion_confirmed",
      payload: { note: "沒有 itemId" },
    });
    const b = await createOrMergeNotification(db, {
      userId: user.id,
      type: "completion_confirmed",
      payload: { note: "沒有 itemId" },
    });

    expect(a.id).not.toBe(b.id);
  });

  it("真的透過 API 連續發送兩則交接訊息 → 對方只收到一筆合併通知（mergedCount=2）", async () => {
    const owner = await createTestUser({ label: "merge-api-owner" });
    const receiver = await createTestUser({ label: "merge-api-receiver" });
    userIds.push(owner.id, receiver.id);

    const itemId = await createPublishedItem(owner);
    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claimRes.status).toBe(201);

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const { conversationId } = ensure.json as { conversationId: string };

    // owner 連發兩則訊息，receiver 應該只收到一筆合併過的 handover_message 通知。
    const msg1 = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: owner,
      body: { body: "你好，我可以今天下午拿嗎？" },
    });
    expect(msg1.status).toBe(201);
    const msg2 = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: owner,
      body: { body: "還是明天比較方便？" },
    });
    expect(msg2.status).toBe(201);

    const notifications = await db.notification.findMany({
      where: { userId: receiver.id, type: "handover_message" },
    });
    expect(notifications).toHaveLength(1);
    expect(mergedCountOf(notifications[0].payload)).toBe(2);
  });
});

describe("M4 每人每日外部通知上限", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    // Notification/NotificationDelivery 都是 onDelete: Cascade（User → Notification →
    // NotificationDelivery），刪使用者就會一併清乾淨，不需要另外手動刪。
    await cleanupTestData(userIds);
  });

  // NotificationDelivery 對 (notificationId, channel) 有 unique 限制，且目前 channel
  // 只有 telegram 一種值，所以「模擬使用者今天已經送出 N 則外部通知」要建立 N 筆各自獨立的
  // Notification（每筆各配一筆 delivery），不能對同一筆 Notification 疊加多筆 delivery。
  async function seedDeliveries(
    userId: string,
    count: number,
    opts: { status?: "pending" | "sent" | "failed"; createdAt?: Date } = {},
  ) {
    for (let i = 0; i < count; i++) {
      const notification = await db.notification.create({
        data: { userId, type: "new_comment", payload: { seed: true, i } },
      });
      await db.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: "telegram",
          status: opts.status ?? "sent",
          createdAt: opts.createdAt ?? new Date(),
        },
      });
    }
  }

  it(`未達每日上限（<${DAILY_EXTERNAL_NOTIFICATION_LIMIT}）→ 允許外送`, async () => {
    const user = await createTestUser({ label: "limit-under" });
    userIds.push(user.id);
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT - 1);

    expect(await shouldSendExternalNotification(user.id)).toBe(true);
  });

  it(`達到每日上限（=${DAILY_EXTERNAL_NOTIFICATION_LIMIT}）→ 停止外送`, async () => {
    const user = await createTestUser({ label: "limit-at" });
    userIds.push(user.id);
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT);

    expect(await shouldSendExternalNotification(user.id)).toBe(false);
  });

  it("pending 狀態的 delivery 也算進今天的額度（尚未送達但已經佔用名額）", async () => {
    const user = await createTestUser({ label: "limit-pending" });
    userIds.push(user.id);
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT, { status: "pending" });

    expect(await shouldSendExternalNotification(user.id)).toBe(false);
  });

  it("failed 狀態的 delivery 不佔用額度（送達失敗不算使用者收到過）", async () => {
    const user = await createTestUser({ label: "limit-failed" });
    userIds.push(user.id);
    // 就算 failed 筆數遠超過上限，也完全不影響今天還能不能送。
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT + 10, { status: "failed" });

    expect(await shouldSendExternalNotification(user.id)).toBe(true);
  });

  it("昨天（台北曆日）的 delivery 不計入今天的額度", async () => {
    const user = await createTestUser({ label: "limit-yesterday" });
    userIds.push(user.id);
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT + 10, {
      status: "sent",
      createdAt: yesterday,
    });

    expect(await shouldSendExternalNotification(user.id)).toBe(true);
  });

  it("可傳自訂 limit 覆蓋預設值（測試/未來調整用）", async () => {
    const user = await createTestUser({ label: "limit-custom" });
    userIds.push(user.id);
    await seedDeliveries(user.id, 2);

    expect(await shouldSendExternalNotification(user.id, { limit: 3 })).toBe(true);
    expect(await shouldSendExternalNotification(user.id, { limit: 2 })).toBe(false);
  });

  it("每日上限只影響外部通知判斷，站內通知（Notification 本身）完全不受影響", async () => {
    const user = await createTestUser({ label: "limit-inapp-unaffected" });
    userIds.push(user.id);
    await seedDeliveries(user.id, DAILY_EXTERNAL_NOTIFICATION_LIMIT);
    expect(await shouldSendExternalNotification(user.id)).toBe(false);

    // 即使已經達到外部上限，站內通知的建立/合併邏輯完全獨立，一樣正常寫入。
    const notification = await createOrMergeNotification(db, {
      userId: user.id,
      type: "completion_confirmed",
      payload: { itemId: "fake-item-inapp", itemTitle: "測試物品" },
    });
    expect(notification.userId).toBe(user.id);

    const stored = await db.notification.findUnique({ where: { id: notification.id } });
    expect(stored).not.toBeNull();
  });
});
