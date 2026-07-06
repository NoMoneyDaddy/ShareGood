import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import {
  cleanupTestData,
  createTestUser,
  sessionCookieHeader,
  type TestUser,
} from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

// master-plan §8 驗收清單：
// 「券碼在 DB 中為密文（直接查 DB 驗證）；未確認接手前 API 不回券碼；揭露有 log。」
// 「手動觸發到期 job：過期物品轉 expired、物主收到通知、job run 有紀錄。」
// 「到期 job 重複觸發不重複通知（idempotent）。」
//
// 對應實作：src/lib/coupon-crypto.ts、src/app/api/items/[id]/coupon/reveal/route.ts、
// src/app/api/jobs/item-expiration/route.ts。
describe("M3 優惠券加密與揭露", () => {
  const userIds: string[] = [];
  let couponCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "coupons" } });
    couponCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  function tomorrow(): string {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it("券碼密文存在 DB、交接確定前不給明文、揭露會寫 log（且不做去重）", async () => {
    const owner = await user("coupon-owner");
    const receiver = await user("coupon-receiver");
    const plainCode = `SECRET-${Date.now()}`;

    const itemId = await createPublishedItem(owner, {
      categoryId: couponCategoryId,
      expiresAt: tomorrow(),
      coupon: { faceValue: "$100 折價", merchantName: "測試商店", code: plainCode },
    });

    // 1) DB 裡是密文，不是明文
    const couponDetail = await db.couponDetail.findUniqueOrThrow({
      where: { itemId },
      include: { secret: true },
    });
    expect(couponDetail.secret).not.toBeNull();
    expect(couponDetail.secret?.ciphertext).not.toContain(plainCode);
    expect(couponDetail.secret?.ciphertext).not.toBe(plainCode);

    // 2) 交接還沒確定（物品還是 published）：任何人（含物主）都拿不到明文
    const revealTooEarly = await api(`/api/items/${itemId}/coupon/reveal`, {
      method: "POST",
      user: owner,
    });
    expect(revealTooEarly.status).toBe(409);

    // 3) 走完整流程到 reserved（留言先到先得）
    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這張券" },
    });
    expect(claimRes.status).toBe(201);

    // reserved 但還沒 ensure handover：還是不給明文
    const revealAtReserved = await api(`/api/items/${itemId}/coupon/reveal`, {
      method: "POST",
      user: receiver,
    });
    expect(revealAtReserved.status).toBe(409);

    // 4) ensure handover → handover_pending
    const ensureRes = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: receiver,
    });
    expect(ensureRes.status).toBe(200);

    // 5) 物主（非接手者）揭露 → 403
    const revealByOwner = await api(`/api/items/${itemId}/coupon/reveal`, {
      method: "POST",
      user: owner,
    });
    expect(revealByOwner.status).toBe(403);

    // 6) 接手者揭露 → 200，明文正確，且寫了一筆 CouponRevealLog
    const revealOk = await api(`/api/items/${itemId}/coupon/reveal`, {
      method: "POST",
      user: receiver,
    });
    expect(revealOk.status).toBe(200);
    expect((revealOk.json as { code: string }).code).toBe(plainCode);

    const logsAfterFirst = await db.couponRevealLog.findMany({
      where: { couponSecretId: couponDetail.secret!.id },
    });
    expect(logsAfterFirst).toHaveLength(1);
    expect(logsAfterFirst[0].revealedBy).toBe(receiver.id);

    // 7) 刻意不做「同一人重複揭露不重複記錄」的 idempotent 保護（見 reveal route 註解）：
    // 再揭露一次，回傳仍是 200 且明文正確，但 log 累積成兩筆。
    const revealAgain = await api(`/api/items/${itemId}/coupon/reveal`, {
      method: "POST",
      user: receiver,
    });
    expect(revealAgain.status).toBe(200);
    expect((revealAgain.json as { code: string }).code).toBe(plainCode);

    const logsAfterSecond = await db.couponRevealLog.findMany({
      where: { couponSecretId: couponDetail.secret!.id },
    });
    expect(logsAfterSecond).toHaveLength(2);
  });

  it("找不到物品 → 404；沒有優惠券資料的物品 → 404", async () => {
    const owner = await user("coupon-404-owner");
    const { cityId, categoryId } = await pickCityAndCategory();
    const plainItemId = await createPublishedItem(owner, { cityId, categoryId });

    const missingItem = await api("/api/items/does-not-exist/coupon/reveal", {
      method: "POST",
      user: owner,
    });
    expect(missingItem.status).toBe(404);

    const noCoupon = await api(`/api/items/${plainItemId}/coupon/reveal`, {
      method: "POST",
      user: owner,
    });
    expect(noCoupon.status).toBe(404);
  });

  it("未登入呼叫揭露 → 401", async () => {
    const owner = await user("coupon-401-owner");
    const itemId = await createPublishedItem(owner, {
      categoryId: couponCategoryId,
      expiresAt: tomorrow(),
      coupon: { faceValue: "$50", merchantName: "測試商店", code: "X" },
    });
    const res = await api(`/api/items/${itemId}/coupon/reveal`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

// master-plan §8 驗收清單：「手動觸發到期 job：過期物品轉 expired、物主收到通知、job run
// 有紀錄」「到期 job 重複觸發不重複通知（idempotent）」。
//
// 對應實作：src/app/api/jobs/item-expiration/route.ts。
describe("M3 到期 job", () => {
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
    const res = await fetch(`${BASE_URL}/api/jobs/item-expiration`, {
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

  it("過期物品轉 expired＋通知物主＋job run 有紀錄；即將到期的物品只提醒不轉態；重複觸發不重複通知", async () => {
    expect(CRON_SECRET).toBeTruthy(); // 沒設 CRON_SECRET 的話這支測試沒有意義，直接讓它失敗

    const expiredOwner = await user("expiring-job-expired-owner");
    const reminderOwner = await user("expiring-job-reminder-owner");
    const controlOwner = await user("expiring-job-control-owner");

    // 已過期物品：POST /api/items 建立時要求 expiresAt > now，沒辦法直接用 API 建立「已過期」
    // 的物品；先用明天的日期建立一個合法物品，再直接改 DB 把 expiresAt 撥回過去，模擬
    // 「已經上架、後來到期了」的真實情境（不是繞過任何 mutation API 的權限檢查，只是跳過
    // 建立時「到期日需晚於現在」這條建立當下才有意義的檢查）。
    const expiredItemId = await createPublishedItem(expiredOwner, {
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    await db.item.update({
      where: { id: expiredItemId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // 即將到期（2 天後，落在 3 天提醒視窗內）
    const reminderItemId = await createPublishedItem(reminderOwner, {
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });

    // 控制組：30 天後到期，job 不應該動它
    const controlItemId = await createPublishedItem(controlOwner, {
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });

    const firstRun = await callJob(CRON_SECRET);
    expect(firstRun.status).toBe(200);
    const firstBody = firstRun.json as {
      jobRunId: string;
      expiredCount: number;
      reminderCount: number;
    };
    expect(firstBody.expiredCount).toBeGreaterThanOrEqual(1);
    expect(firstBody.reminderCount).toBeGreaterThanOrEqual(1);

    // job run 有紀錄
    const jobRun = await db.systemJobRun.findUniqueOrThrow({ where: { id: firstBody.jobRunId } });
    expect(jobRun.status).toBe("success");

    // 過期物品：轉態 + ItemExpirationLog + 通知物主
    const expiredItem = await db.item.findUniqueOrThrow({ where: { id: expiredItemId } });
    expect(expiredItem.status).toBe("expired");
    const expiredLogs = await db.itemExpirationLog.findMany({
      where: { itemId: expiredItemId, action: "expired" },
    });
    expect(expiredLogs).toHaveLength(1);
    const expiredNotifications = await db.notification.findMany({
      where: { userId: expiredOwner.id },
    });
    expect(expiredNotifications).toHaveLength(1);
    expect((expiredNotifications[0].payload as { kind?: string }).kind).toBe("item_expired");

    // 即將到期：不轉態，只提醒一次
    const reminderItem = await db.item.findUniqueOrThrow({ where: { id: reminderItemId } });
    expect(reminderItem.status).toBe("published");
    const reminderLogs = await db.itemExpirationLog.findMany({
      where: { itemId: reminderItemId, action: "reminder_sent" },
    });
    expect(reminderLogs).toHaveLength(1);
    const reminderNotifications = await db.notification.findMany({
      where: { userId: reminderOwner.id },
    });
    expect(reminderNotifications).toHaveLength(1);
    expect((reminderNotifications[0].payload as { kind?: string }).kind).toBe(
      "item_expiring_reminder",
    );

    // 控制組：完全沒被動到
    const controlItem = await db.item.findUniqueOrThrow({ where: { id: controlItemId } });
    expect(controlItem.status).toBe("published");
    const controlLogs = await db.itemExpirationLog.findMany({ where: { itemId: controlItemId } });
    expect(controlLogs).toHaveLength(0);
    const controlNotifications = await db.notification.findMany({
      where: { userId: controlOwner.id },
    });
    expect(controlNotifications).toHaveLength(0);

    // 重複觸發：idempotent，不重複轉態、不重複通知
    const secondRun = await callJob(CRON_SECRET);
    expect(secondRun.status).toBe(200);

    const expiredLogsAfterSecond = await db.itemExpirationLog.findMany({
      where: { itemId: expiredItemId, action: "expired" },
    });
    expect(expiredLogsAfterSecond).toHaveLength(1);
    const expiredNotificationsAfterSecond = await db.notification.findMany({
      where: { userId: expiredOwner.id },
    });
    expect(expiredNotificationsAfterSecond).toHaveLength(1);

    const reminderLogsAfterSecond = await db.itemExpirationLog.findMany({
      where: { itemId: reminderItemId, action: "reminder_sent" },
    });
    expect(reminderLogsAfterSecond).toHaveLength(1);
    const reminderNotificationsAfterSecond = await db.notification.findMany({
      where: { userId: reminderOwner.id },
    });
    expect(reminderNotificationsAfterSecond).toHaveLength(1);
  });

  // 併發安全：如果物品在 job 查出候選清單之後、實際執行 transaction 之前，已經被別人預約
  // 進入 reserved（甚至 handover_pending），這支 job 不該用無條件 update 把它蓋成 expired、
  // 蓋掉正在進行的交接。用「先建立已過期但仍是 published 的物品、再讓它被搶先認領變成
  // reserved、才觸發 job」模擬這個時序（見 src/app/api/jobs/item-expiration/route.ts
  // processExpired 的 updateMany({ where: { status: "published" } }) 防呆）。
  it("物品到期當下已不是 published（例如剛好被預約成 reserved）→ job 不會強制轉態", async () => {
    expect(CRON_SECRET).toBeTruthy();

    const owner = await user("expiring-job-reserved-owner");
    const receiver = await user("expiring-job-reserved-receiver");

    const itemId = await createPublishedItem(owner, {
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    // 先讓它「已到期」，但這時還是 published——對應 job 查候選清單那一刻的狀態。
    await db.item.update({
      where: { id: itemId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    // 在 job 真正執行 transaction 之前，物品已經被接手者認領變成 reserved。
    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claimRes.status).toBe(201);
    const reservedItem = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(reservedItem.status).toBe("reserved");

    const run = await callJob(CRON_SECRET);
    expect(run.status).toBe(200);

    // 物品維持 reserved，沒有被 job 蓋成 expired，也沒有留下到期 log 或到期通知——
    // 讓它自然被排除，交由 M1 既有交接流程繼續走。（物主此時已經有一筆「有人留言／認領」
    // 的通知，那是留言流程本身送的，跟這支 job 無關，所以只檢查 job 會送的
    // kind: "item_expired" 通知沒有被送出，不檢查通知總數。）
    const afterJob = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(afterJob.status).toBe("reserved");
    const logs = await db.itemExpirationLog.findMany({ where: { itemId } });
    expect(logs).toHaveLength(0);
    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    const expiredNotifications = notifications.filter(
      (n) => (n.payload as { kind?: string }).kind === "item_expired",
    );
    expect(expiredNotifications).toHaveLength(0);
  });
});

// master-plan §8 交付內容第 4 項：「列表『即將到期』排序加權」。
// 對應實作：src/app/api/items/route.ts 的 GET（sort=expiring）。
describe("M3 列表 sort=expiring 排序加權", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("sort=expiring 時快到期的物品排前面，沒設到期日的排最後；預設排序不受影響", async () => {
    const owner = await createTestUser({ label: "sort-expiring-owner" });
    userIds.push(owner.id);
    const { cityId, categoryId } = await pickCityAndCategory();
    const title = `排序測試-${Date.now()}`;

    const soon = await createPublishedItem(owner, {
      title: `${title}-soon`,
      cityId,
      categoryId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    const later = await createPublishedItem(owner, {
      title: `${title}-later`,
      cityId,
      categoryId,
      expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    const noExpiry = await createPublishedItem(owner, {
      title: `${title}-no-expiry`,
      cityId,
      categoryId,
    });

    const res = await api(
      `/api/items?cityId=${cityId}&categoryId=${categoryId}&sort=expiring&limit=50`,
    );
    expect(res.status).toBe(200);
    const ids = (res.json as { items: Array<{ id: string }> }).items.map((i) => i.id);
    const soonIdx = ids.indexOf(soon);
    const laterIdx = ids.indexOf(later);
    const noExpiryIdx = ids.indexOf(noExpiry);
    expect(soonIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThan(soonIdx);
    expect(noExpiryIdx).toBeGreaterThan(laterIdx);

    // 預設排序（沒帶 sort）維持原本 createdAt desc 行為：三筆都在，不特別要求順序，
    // 只驗證這個既有行為沒有被 sort=expiring 的新邏輯波及。
    const defaultRes = await api(`/api/items?cityId=${cityId}&categoryId=${categoryId}&limit=50`);
    const defaultIds = (defaultRes.json as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(defaultIds).toEqual(expect.arrayContaining([soon, later, noExpiry]));
  });
});

// master-plan §8 驗收清單：「錢包頁正確分列已分享/已接手」。
//
// 對應實作：src/app/me/wallet/page.tsx。
describe("M3 優惠券錢包 /me/wallet", () => {
  const userIds: string[] = [];
  let couponCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "coupons" } });
    couponCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("物主看得到「我分享的券」、接手者看得到「我接手的券」", async () => {
    const owner = await user("wallet-owner");
    const receiver = await user("wallet-receiver");
    const title = `錢包測試券-${Date.now()}`;

    const itemId = await createPublishedItem(owner, {
      title,
      categoryId: couponCategoryId,
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      coupon: { faceValue: "$200 折價", merchantName: "錢包測試商店", code: "WALLET-CODE" },
    });
    await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我要" },
    });
    await api(`/api/items/${itemId}/handover/ensure`, { method: "POST", user: receiver });

    const ownerRes = await fetch(`${BASE_URL}/me/wallet`, {
      headers: { cookie: sessionCookieHeader(owner) },
    });
    expect(ownerRes.status).toBe(200);
    const ownerHtml = await ownerRes.text();
    expect(ownerHtml).toContain("我分享的券");
    expect(ownerHtml).toContain(title);

    const receiverRes = await fetch(`${BASE_URL}/me/wallet`, {
      headers: { cookie: sessionCookieHeader(receiver) },
    });
    expect(receiverRes.status).toBe(200);
    const receiverHtml = await receiverRes.text();
    expect(receiverHtml).toContain("我接手的券");
    expect(receiverHtml).toContain(title);
  });

  it("未登入造訪 /me/wallet → 導回首頁", async () => {
    const res = await fetch(`${BASE_URL}/me/wallet`, { redirect: "manual" });
    expect(res.status).toBe(307);
  });
});
