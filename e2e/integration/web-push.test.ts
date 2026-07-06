import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// master-plan §6a 交付內容 9 驗收清單：
// 「模擬 webpush.sendNotification 回應 410 Gone → 對應 web_push_subscriptions 那一筆
// 立刻 isActive=false／deactivatedAt 有值；之後再次派送該使用者的通知不會再嘗試這個
// 失效端點。」
//
// Web Push 實際發送到瀏覽器的部分無法在整合測試裡端到端驗證（見任務交代）：這裡直接
// import src/lib/web-push.ts 的 sendWebPushToUser，mock 掉 web-push 套件本身，測試
// 「呼叫 sendNotification 前的邏輯」與「失敗處理邏輯」——跟其餘整合測試一律打
// 正在跑的 dev server（見 e2e/support/api.ts）不同，是因為 mock 一個 npm 套件只能在
// 跟被測程式碼同一個 process 裡生效，dev server 是獨立 process，沒辦法從這裡 mock 它
// 載入的模組。DB 讀寫仍然是對同一個 Postgres 資料庫，跟其餘測試共用同一份真實資料。
const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => {
  const mod = {
    sendNotification: mocks.sendNotification,
    setVapidDetails: mocks.setVapidDetails,
    generateVAPIDKeys: vi.fn(),
  };
  return { default: mod, ...mod };
});

const { sendWebPushToUser } = await import("@/lib/web-push");

describe("M6 Web Push 發送邏輯與失效偵測", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  afterEach(() => {
    mocks.sendNotification.mockReset();
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("使用者名下沒有任何 isActive 裝置 → attempted=false，不呼叫 sendNotification", async () => {
    const u = await user("webpush-none");

    const result = await sendWebPushToUser(u.id, {
      title: "標題",
      body: "內容",
      itemUrl: "/items/x",
    });

    expect(result).toEqual({ attempted: false, anySuccess: false });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("成功送達 → anySuccess=true，更新 lastSuccessAt 並把 failureCount 歸零", async () => {
    const u = await user("webpush-success");
    const sub = await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-ok`,
        p256dhKey: "p256dh-key",
        authKey: "auth-key",
        failureCount: 3,
      },
    });
    mocks.sendNotification.mockResolvedValueOnce({ statusCode: 201, headers: {}, body: "" });

    const result = await sendWebPushToUser(u.id, {
      title: "標題",
      body: "內容",
      itemUrl: "/items/x",
    });

    expect(result).toEqual({ attempted: true, anySuccess: true });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const [subscriptionArg, payloadArg] = mocks.sendNotification.mock.calls[0];
    expect(subscriptionArg).toEqual({
      endpoint: sub.endpoint,
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(JSON.parse(payloadArg)).toEqual({
      title: "標題",
      body: "內容",
      itemUrl: "/items/x",
    });

    const updated = await db.webPushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.isActive).toBe(true);
    expect(updated.failureCount).toBe(0);
    expect(updated.lastSuccessAt).not.toBeNull();
  });

  it("410 Gone → 立刻停用該筆訂閱，之後不再嘗試這個失效端點", async () => {
    const u = await user("webpush-410");
    const sub = await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-410`,
        p256dhKey: "p",
        authKey: "a",
      },
    });
    mocks.sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );

    const result = await sendWebPushToUser(u.id, {
      title: "t",
      body: "b",
      itemUrl: "/items/x",
    });
    expect(result).toEqual({ attempted: true, anySuccess: false });

    const updated = await db.webPushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.isActive).toBe(false);
    expect(updated.deactivatedAt).not.toBeNull();

    mocks.sendNotification.mockClear();
    const secondResult = await sendWebPushToUser(u.id, {
      title: "t",
      body: "b",
      itemUrl: "/items/x",
    });
    expect(secondResult).toEqual({ attempted: false, anySuccess: false });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("404 Not Found → 同樣視為裝置已失效，立刻停用", async () => {
    const u = await user("webpush-404");
    const sub = await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-404`,
        p256dhKey: "p",
        authKey: "a",
      },
    });
    mocks.sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { statusCode: 404 }),
    );

    await sendWebPushToUser(u.id, { title: "t", body: "b", itemUrl: "/items/x" });

    const updated = await db.webPushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.isActive).toBe(false);
    expect(updated.deactivatedAt).not.toBeNull();
  });

  it("暫時性錯誤（例如 500）→ 只累計 failureCount，不動 isActive", async () => {
    const u = await user("webpush-500");
    const sub = await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-500`,
        p256dhKey: "p",
        authKey: "a",
      },
    });
    mocks.sendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Server error"), { statusCode: 500 }),
    );

    const result = await sendWebPushToUser(u.id, { title: "t", body: "b", itemUrl: "/items/x" });
    expect(result).toEqual({ attempted: true, anySuccess: false });

    const updated = await db.webPushSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.isActive).toBe(true);
    expect(updated.failureCount).toBe(1);
    expect(updated.lastFailureAt).not.toBeNull();
  });

  it("多裝置：任一裝置成功即整體 anySuccess=true，會對每個 isActive 裝置各發一次", async () => {
    const u = await user("webpush-multi");
    await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-a`,
        p256dhKey: "p",
        authKey: "a",
      },
    });
    await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-b`,
        p256dhKey: "p",
        authKey: "a",
      },
    });

    mocks.sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("fail"), { statusCode: 500 }))
      .mockResolvedValueOnce({ statusCode: 201, headers: {}, body: "" });

    const result = await sendWebPushToUser(u.id, { title: "t", body: "b", itemUrl: "/items/x" });
    expect(result).toEqual({ attempted: true, anySuccess: true });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("已停用（isActive=false）的裝置不會被拿來嘗試發送", async () => {
    const u = await user("webpush-inactive");
    await db.webPushSubscription.create({
      data: {
        userId: u.id,
        endpoint: `https://push.example.test/${u.id}-inactive`,
        p256dhKey: "p",
        authKey: "a",
        isActive: false,
        deactivatedAt: new Date(),
      },
    });

    const result = await sendWebPushToUser(u.id, { title: "t", body: "b", itemUrl: "/items/x" });
    expect(result).toEqual({ attempted: false, anySuccess: false });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
