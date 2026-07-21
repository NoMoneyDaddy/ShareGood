import { afterAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// M12 交付內容 5（面交約定時間，docs/plan/m12-product-growth.md）：
// PATCH /api/handover/[id]/meetup（設定/修改/清空約定時間，任一方可設不需雙方確認）與
// POST /api/jobs/handover-meetup-reminder（提前 2 小時提醒 job）。
//
// 驗收要點對應規格：任一方設定時間後對方看得到；修改時間後 reminderSentAt 重置；到期提醒
// 窗口到達時雙方收到通知；已完成/no_show 的交接無法再修改約定時間（409）；job 重複觸發不
// 重複通知（idempotent）；時間驗證擋過去時間與超過 90 天的輸入。
async function toHandoverPending(
  owner: TestUser,
  receiver: TestUser,
): Promise<{ itemId: string; handoverId: string }> {
  const itemId = await createPublishedItem(owner, { title: `面交測試物品-${Date.now()}` });
  const claimRes = await api(`/api/items/${itemId}/claims`, {
    method: "POST",
    user: receiver,
    body: { message: "我想要這個" },
  });
  expect(claimRes.status).toBe(201);
  const ensureRes = await api(`/api/items/${itemId}/handover/ensure`, {
    method: "POST",
    user: receiver,
  });
  expect(ensureRes.status).toBe(200);
  const handover = await db.handoverRecord.findUniqueOrThrow({ where: { itemId } });
  return { itemId, handoverId: handover.id };
}

describe("M12 交付內容 5：PATCH /api/handover/[id]/meetup", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  function hoursFromNow(h: number): string {
    return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
  }

  it("物主可以設定約定時間，接手者看得到（DB 值一致）；接手者也可以修改", async () => {
    const owner = await user("meetup-owner");
    const receiver = await user("meetup-receiver");
    const { handoverId } = await toHandoverPending(owner, receiver);

    const scheduledAt = hoursFromNow(5);
    const setRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt },
    });
    expect(setRes.status).toBe(200);
    expect((setRes.json as { scheduledAt: string }).scheduledAt).toBe(scheduledAt);

    const afterOwnerSet = await db.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });
    expect(afterOwnerSet.scheduledAt?.toISOString()).toBe(scheduledAt);

    // 接手者（非設定者）也能修改成另一個時間（任一方可設，後寫覆蓋）。
    const newScheduledAt = hoursFromNow(10);
    const modifyRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: receiver,
      body: { scheduledAt: newScheduledAt },
    });
    expect(modifyRes.status).toBe(200);
    const afterReceiverModify = await db.handoverRecord.findUniqueOrThrow({
      where: { id: handoverId },
    });
    expect(afterReceiverModify.scheduledAt?.toISOString()).toBe(newScheduledAt);
  });

  it("修改已通知過的 scheduledAt 會把 reminderSentAt 重設為 null；清空也會重設", async () => {
    const owner = await user("meetup-reset-owner");
    const receiver = await user("meetup-reset-receiver");
    const { handoverId } = await toHandoverPending(owner, receiver);

    // 先設定一次時間，再直接在 DB 模擬「job 已經提醒過」（reminderSentAt 有值）。
    const firstScheduledAt = hoursFromNow(1.5);
    const setRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: firstScheduledAt },
    });
    expect(setRes.status).toBe(200);
    await db.handoverRecord.update({
      where: { id: handoverId },
      data: { reminderSentAt: new Date() },
    });
    const afterFakeRemind = await db.handoverRecord.findUniqueOrThrow({
      where: { id: handoverId },
    });
    expect(afterFakeRemind.reminderSentAt).not.toBeNull();

    // 修改時間：reminderSentAt 必須被重設為 null（規格關鍵行為，見 route 實作註解）。
    const modifyRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: hoursFromNow(1.8) },
    });
    expect(modifyRes.status).toBe(200);
    const afterModify = await db.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });
    expect(afterModify.reminderSentAt).toBeNull();

    // 再模擬一次已提醒過，這次測試「清空」也會重設 reminderSentAt。
    await db.handoverRecord.update({
      where: { id: handoverId },
      data: { reminderSentAt: new Date() },
    });
    const clearRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: receiver,
      body: { scheduledAt: null },
    });
    expect(clearRes.status).toBe(200);
    expect((clearRes.json as { scheduledAt: string | null }).scheduledAt).toBeNull();
    const afterClear = await db.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });
    expect(afterClear.scheduledAt).toBeNull();
    expect(afterClear.reminderSentAt).toBeNull();
  });

  it("時間驗證：過去時間與超過 90 天皆回 422", async () => {
    const owner = await user("meetup-validate-owner");
    const receiver = await user("meetup-validate-receiver");
    const { handoverId } = await toHandoverPending(owner, receiver);

    const pastRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(pastRes.status).toBe(422);

    const tooFarRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(tooFarRes.status).toBe(422);

    const malformedRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: "not-a-date" },
    });
    expect(malformedRes.status).toBe(422);
  });

  it("非物主/接手者操作 → 403；未登入 → 401；已完成的交接無法再設定 → 409", async () => {
    const owner = await user("meetup-perm-owner");
    const receiver = await user("meetup-perm-receiver");
    const stranger = await user("meetup-perm-stranger");
    const { handoverId } = await toHandoverPending(owner, receiver);

    const strangerRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: stranger,
      body: { scheduledAt: hoursFromNow(3) },
    });
    expect(strangerRes.status).toBe(403);

    const anonRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      body: { scheduledAt: hoursFromNow(3) },
    });
    expect(anonRes.status).toBe(401);

    // 雙方都標記完成 → completed，之後不能再修改約定時間。
    const ownerComplete = await api(`/api/handover/${handoverId}/complete`, {
      method: "PATCH",
      user: owner,
    });
    expect(ownerComplete.status).toBe(200);
    const receiverComplete = await api(`/api/handover/${handoverId}/complete`, {
      method: "PATCH",
      user: receiver,
    });
    expect(receiverComplete.status).toBe(200);
    expect((receiverComplete.json as { status: string }).status).toBe("completed");

    const afterCompleteRes = await api(`/api/handover/${handoverId}/meetup`, {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: hoursFromNow(3) },
    });
    expect(afterCompleteRes.status).toBe(409);
  });

  it("找不到交接紀錄 → 404", async () => {
    const owner = await user("meetup-404-owner");
    const res = await api("/api/handover/does-not-exist/meetup", {
      method: "PATCH",
      user: owner,
      body: { scheduledAt: hoursFromNow(3) },
    });
    expect(res.status).toBe(404);
  });
});

describe("M12 交付內容 5：POST /api/jobs/handover-meetup-reminder", () => {
  const userIds: string[] = [];
  const CRON_SECRET = process.env.CRON_SECRET;

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function callJob(secret: string | undefined) {
    const res = await fetch(`${BASE_URL}/api/jobs/handover-meetup-reminder`, {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  it("錯誤／缺少 CRON_SECRET → 401", async () => {
    const wrong = await callJob("wrong-secret");
    expect(wrong.status).toBe(401);
    const missing = await callJob(undefined);
    expect(missing.status).toBe(401);
  });

  it(
    "落在提醒窗口（2 小時內）的交接雙方都收到通知＋reminderSentAt 寫入；" +
      "窗口外的控制組不受影響；重複觸發不重複通知（idempotent）",
    async () => {
      expect(CRON_SECRET).toBeTruthy();

      const dueOwner = await user("meetup-job-due-owner");
      const dueReceiver = await user("meetup-job-due-receiver");
      const farOwner = await user("meetup-job-far-owner");
      const farReceiver = await user("meetup-job-far-receiver");

      const { handoverId: dueHandoverId } = await toHandoverPending(dueOwner, dueReceiver);
      // 直接改 DB 把約定時間撥到 1 小時後（落在 2 小時提醒窗口內），略過 API 層的
      // 「不能設定過去時間」檢查沒有意義——這裡本來就是未來時間，只是刻意精準落進窗口。
      await db.handoverRecord.update({
        where: { id: dueHandoverId },
        data: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000) },
      });

      const { handoverId: farHandoverId } = await toHandoverPending(farOwner, farReceiver);
      await db.handoverRecord.update({
        where: { id: farHandoverId },
        data: { scheduledAt: new Date(Date.now() + 30 * 60 * 60 * 1000) }, // 30 小時後，窗口外
      });

      const firstRun = await callJob(CRON_SECRET);
      expect(firstRun.status).toBe(200);
      const firstBody = firstRun.json as { jobRunId: string; remindedCount: number };
      expect(firstBody.remindedCount).toBeGreaterThanOrEqual(1);

      const jobRun = await db.systemJobRun.findUniqueOrThrow({ where: { id: firstBody.jobRunId } });
      expect(jobRun.status).toBe("success");

      // 到期組：reminderSentAt 寫入 + 雙方各自收到 kind: handover_meetup_reminder 通知。
      const dueHandover = await db.handoverRecord.findUniqueOrThrow({
        where: { id: dueHandoverId },
      });
      expect(dueHandover.reminderSentAt).not.toBeNull();

      const dueOwnerNotifications = await db.notification.findMany({
        where: { userId: dueOwner.id },
      });
      const dueOwnerMeetup = dueOwnerNotifications.filter(
        (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
      );
      expect(dueOwnerMeetup).toHaveLength(1);

      const dueReceiverNotifications = await db.notification.findMany({
        where: { userId: dueReceiver.id },
      });
      const dueReceiverMeetup = dueReceiverNotifications.filter(
        (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
      );
      expect(dueReceiverMeetup).toHaveLength(1);

      // 控制組：窗口外，完全不受影響。
      const farHandover = await db.handoverRecord.findUniqueOrThrow({
        where: { id: farHandoverId },
      });
      expect(farHandover.reminderSentAt).toBeNull();
      const farOwnerNotifications = await db.notification.findMany({
        where: { userId: farOwner.id },
      });
      expect(
        farOwnerNotifications.filter(
          (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
        ),
      ).toHaveLength(0);

      // 重複觸發：idempotent，不重複通知。
      const secondRun = await callJob(CRON_SECRET);
      expect(secondRun.status).toBe(200);
      const dueOwnerNotificationsAfterSecond = await db.notification.findMany({
        where: { userId: dueOwner.id },
      });
      expect(
        dueOwnerNotificationsAfterSecond.filter(
          (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
        ),
      ).toHaveLength(1);
    },
  );

  it("已完成的交接即使 scheduledAt 落在窗口內，也不會被提醒（status 不是 pending）", async () => {
    expect(CRON_SECRET).toBeTruthy();

    const owner = await user("meetup-job-completed-owner");
    const receiver = await user("meetup-job-completed-receiver");
    const { handoverId } = await toHandoverPending(owner, receiver);

    await db.handoverRecord.update({
      where: { id: handoverId },
      data: { scheduledAt: new Date(Date.now() + 30 * 60 * 1000) },
    });

    const ownerComplete = await api(`/api/handover/${handoverId}/complete`, {
      method: "PATCH",
      user: owner,
    });
    expect(ownerComplete.status).toBe(200);
    const receiverComplete = await api(`/api/handover/${handoverId}/complete`, {
      method: "PATCH",
      user: receiver,
    });
    expect(receiverComplete.status).toBe(200);

    const run = await callJob(CRON_SECRET);
    expect(run.status).toBe(200);

    const afterJob = await db.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });
    expect(afterJob.reminderSentAt).toBeNull();
    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(
      notifications.filter(
        (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
      ),
    ).toHaveLength(0);
  });

  it("使用者把 handover_meetup_reminder 站內通知偏好關掉時，job 不建立站內通知（但 reminderSentAt 仍會寫入，不重複觸發）", async () => {
    expect(CRON_SECRET).toBeTruthy();

    const owner = await user("meetup-job-pref-off-owner");
    const receiver = await user("meetup-job-pref-off-receiver");
    const { handoverId } = await toHandoverPending(owner, receiver);
    await db.handoverRecord.update({
      where: { id: handoverId },
      data: { scheduledAt: new Date(Date.now() + 45 * 60 * 1000) },
    });

    await db.notificationPreference.create({
      data: {
        userId: owner.id,
        eventType: "handover_meetup_reminder",
        inAppEnabled: false,
        externalEnabled: false,
      },
    });

    const run = await callJob(CRON_SECRET);
    expect(run.status).toBe(200);

    const afterJob = await db.handoverRecord.findUniqueOrThrow({ where: { id: handoverId } });
    // 即使 inAppEnabled=false，reminderSentAt 仍要寫入（idempotent 保護不依賴通知是否真的建立）。
    expect(afterJob.reminderSentAt).not.toBeNull();

    const ownerNotifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(
      ownerNotifications.filter(
        (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
      ),
    ).toHaveLength(0);

    // 接手者沒有關閉偏好，仍應收到通知。
    const receiverNotifications = await db.notification.findMany({
      where: { userId: receiver.id },
    });
    expect(
      receiverNotifications.filter(
        (n) => (n.payload as { kind?: string }).kind === "handover_meetup_reminder",
      ),
    ).toHaveLength(1);
  });
});
