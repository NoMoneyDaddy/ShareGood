import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §8 驗收清單：
// 「手動觸發到期 job：過期物品轉 expired、物主收到通知、job run 有紀錄」
// 「到期 job 重複觸發不重複通知（idempotent）」
//
// 對應實作在 src/app/api/jobs/expiration-check/route.ts。這支 job 一次處理兩件事：
//   1. 已過期（status='published' 且 expiresAt<=now）→ 轉 expired，寫 ItemStatusLog，通知物主。
//   2. 即將到期（status='published' 且 expiresAt 落在未來 3 天內）→ 不轉狀態，只發一次提醒。
// 兩者都靠 ItemExpirationLog 的 @@unique([itemId, action]) 擋重複處理，這裡直接查 DB 驗證
// 而不只看 API 回應的統計數字——因為本機共用 Postgres，這支測試的斷言刻意只看「跟自己
// 建立的那筆物品/使用者相關的最終狀態」，不對 job 回應裡的全域 expiredCount/reminderCount
// 做精確比對，避免跟其他同時在跑的流程互相干擾。
async function triggerExpirationJob(token?: string) {
  const res = await fetch(`${BASE_URL}/api/jobs/expiration-check`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

describe("M3 到期檢查 job", () => {
  const userIds: string[] = [];
  const CRON_SECRET = process.env.CRON_SECRET;

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("沒帶正確 CRON_SECRET → 401", async () => {
    const noAuth = await triggerExpirationJob();
    expect(noAuth.status).toBe(401);

    // 注意：Authorization header 值必須是 ByteString（不能有非 Latin1 字元），
    // 用中文字串當假 token 會讓 fetch 直接丟 TypeError，測不到我們要驗的 401 情境，
    // 所以這裡故意用純 ASCII 的錯誤 token。
    const wrongAuth = await triggerExpirationJob("wrong-token-not-the-real-secret");
    expect(wrongAuth.status).toBe(401);
  });

  it("已過期物品轉 expired、寫入 ItemStatusLog、通知物主；SystemJobRun 有紀錄；重複觸發不重複通知", async () => {
    if (!CRON_SECRET) throw new Error("測試需要 .env 設定 CRON_SECRET");

    const owner = await createTestUser({ label: "expjob-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title: "已過期的測試物品" });

    // 直接把 expiresAt 設成過去時間，模擬「已經過期但還沒被 job 處理過」的狀態
    // （目前物品建立 API 還不支援直接帶 expiresAt，所以用 db 直接改）。
    await db.item.update({
      where: { id: itemId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const first = await triggerExpirationJob(CRON_SECRET);
    expect(first.status).toBe(200);
    const firstJobRunId = (first.json as { jobRunId: string }).jobRunId;

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("expired");

    const statusLogs = await db.itemStatusLog.findMany({
      where: { itemId, toStatus: "expired" },
    });
    expect(statusLogs).toHaveLength(1);
    expect(statusLogs[0].actorId).toBeNull(); // 系統觸發，沒有 actor

    const expirationLogs = await db.itemExpirationLog.findMany({
      where: { itemId, action: "expired" },
    });
    expect(expirationLogs).toHaveLength(1);

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].payload).toMatchObject({ itemId, expirationAction: "expired" });

    const run = await db.systemJobRun.findUniqueOrThrow({ where: { id: firstJobRunId } });
    expect(run.status).toBe("success");
    expect(run.finishedAt).not.toBeNull();

    // 重複觸發：物品已經是 expired（不再符合 status='published' 的候選條件），加上
    // ItemExpirationLog 的 unique(itemId, action) 雙重防線，確認不會重複通知、不會重複寫 log。
    const second = await triggerExpirationJob(CRON_SECRET);
    expect(second.status).toBe(200);

    const notificationsAfterSecondRun = await db.notification.findMany({
      where: { userId: owner.id },
    });
    expect(notificationsAfterSecondRun).toHaveLength(1);

    const expirationLogsAfterSecondRun = await db.itemExpirationLog.findMany({
      where: { itemId, action: "expired" },
    });
    expect(expirationLogsAfterSecondRun).toHaveLength(1);

    const statusLogsAfterSecondRun = await db.itemStatusLog.findMany({
      where: { itemId, toStatus: "expired" },
    });
    expect(statusLogsAfterSecondRun).toHaveLength(1);
  });

  // 上一條測試是「依序」觸發兩次：第二次觸發時物品已經是 expired，根本不會再被
  // findMany 撈到候選名單，所以測不到 expireItem() 裡真正的 transaction + P2002
  // 那一層防線（同一物品在「還沒轉態前」被兩個請求同時當成候選的競態窗口）。
  // 比照 M1 留言/認領那條併發測試的教訓（見 CLAUDE.md M1 進度說明），這裡改成
  // 真的用 Promise.all 同時打兩個請求，逼兩邊在同一個時間點都把這個物品當成候選，
  // 確認 ItemExpirationLog 的 unique(itemId, action) 在 transaction 內確實擋住其中一邊。
  it("同一個到期物品被兩個並發請求同時處理，只會轉態一次、只通知一次", async () => {
    if (!CRON_SECRET) throw new Error("測試需要 .env 設定 CRON_SECRET");

    const owner = await createTestUser({ label: "expjob-race-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title: "併發到期測試物品" });

    await db.item.update({
      where: { id: itemId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const [first, second] = await Promise.all([
      triggerExpirationJob(CRON_SECRET),
      triggerExpirationJob(CRON_SECRET),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("expired");

    const expirationLogs = await db.itemExpirationLog.findMany({
      where: { itemId, action: "expired" },
    });
    expect(expirationLogs).toHaveLength(1);

    const statusLogs = await db.itemStatusLog.findMany({
      where: { itemId, toStatus: "expired" },
    });
    expect(statusLogs).toHaveLength(1);

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(notifications).toHaveLength(1);
  });

  it("3 天內到期的物品收到提醒通知（不轉狀態）；重複觸發不重複提醒", async () => {
    if (!CRON_SECRET) throw new Error("測試需要 .env 設定 CRON_SECRET");

    const owner = await createTestUser({ label: "expjob-reminder-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title: "即將到期的測試物品" });

    await db.item.update({
      where: { id: itemId },
      data: { expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }, // 2 天後到期
    });

    const first = await triggerExpirationJob(CRON_SECRET);
    expect(first.status).toBe(200);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published"); // 只是提醒，不轉狀態

    const reminderLogs = await db.itemExpirationLog.findMany({
      where: { itemId, action: "reminder_sent" },
    });
    expect(reminderLogs).toHaveLength(1);

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].payload).toMatchObject({
      itemId,
      expirationAction: "reminder_sent",
    });

    const second = await triggerExpirationJob(CRON_SECRET);
    expect(second.status).toBe(200);

    const notificationsAfterSecondRun = await db.notification.findMany({
      where: { userId: owner.id },
    });
    expect(notificationsAfterSecondRun).toHaveLength(1); // 沒有重複提醒

    const reminderLogsAfterSecondRun = await db.itemExpirationLog.findMany({
      where: { itemId, action: "reminder_sent" },
    });
    expect(reminderLogsAfterSecondRun).toHaveLength(1);
  });

  it("還很久才到期（超過 3 天）的物品不會被誤觸發", async () => {
    if (!CRON_SECRET) throw new Error("測試需要 .env 設定 CRON_SECRET");

    const owner = await createTestUser({ label: "expjob-farfuture-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner, { title: "很久之後才到期的測試物品" });

    await db.item.update({
      where: { id: itemId },
      data: { expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) }, // 10 天後，超過 3 天提醒窗口
    });

    const res = await triggerExpirationJob(CRON_SECRET);
    expect(res.status).toBe(200);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const logs = await db.itemExpirationLog.findMany({ where: { itemId } });
    expect(logs).toHaveLength(0);

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(notifications).toHaveLength(0);
  });
});
