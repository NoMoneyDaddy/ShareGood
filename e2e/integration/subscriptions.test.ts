import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMatch, normalizeKeyword } from "@/lib/subscriptions";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

const CRON_SECRET = process.env.CRON_SECRET;

// secret === undefined（省略第二個參數）代表「用正確的 CRON_SECRET」；secret === null 代表
// 「完全不帶 authorization header」——不能沿用 JS 預設參數只在傳入 undefined 時生效的語意，
// 否則測試呼叫端沒辦法明確表達「故意不帶 header」跟「用預設值」這兩種不同意圖。
async function callJob(path: string, secret?: string | null) {
  const token = secret === undefined ? CRON_SECRET : secret;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function kindsOf(notifications: { payload: unknown }[]): string[] {
  return notifications
    .map((n) => (n.payload as { kind?: string }).kind)
    .filter((k): k is string => typeof k === "string");
}

// master-plan §6a 驗收清單（訂閱建立/編輯/刪除 API，交付內容 3）。
describe("M6 訂閱 CRUD 驗證", () => {
  const userIds: string[] = [];
  let categoryId: string;
  let cityId: string;

  beforeAll(async () => {
    ({ categoryId, cityId } = await pickCityAndCategory());
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("未登入 → 401", async () => {
    const res = await api("/api/subscriptions", {
      method: "POST",
      body: { categoryIds: [categoryId] },
    });
    expect(res.status).toBe(401);
  });

  it("三個篩選維度皆空 → 422", async () => {
    const u = await user("sub-empty");
    const res = await api("/api/subscriptions", { method: "POST", user: u, body: {} });
    expect(res.status).toBe(422);
  });

  it("關鍵字超過 5 個 → 422", async () => {
    const u = await user("sub-too-many-keywords");
    const res = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { keywords: ["a", "b", "c", "d", "e", "f"] },
    });
    expect(res.status).toBe(422);
  });

  it("關鍵字正規化後長度為 0（純空白）→ 422", async () => {
    const u = await user("sub-blank-keyword");
    const res = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { keywords: ["   "] },
    });
    expect(res.status).toBe(422);
  });

  it("已有 20 筆訂閱時 → 422", async () => {
    const u = await user("sub-limit");
    const created = await db.$transaction(async (tx) => {
      const subs = [];
      for (let i = 0; i < 20; i++) {
        subs.push(await tx.userSubscription.create({ data: { userId: u.id } }));
      }
      await tx.subscriptionCategory.createMany({
        data: subs.map((s) => ({ subscriptionId: s.id, categoryId })),
      });
      return subs;
    });
    expect(created).toHaveLength(20);

    const res = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { categoryIds: [categoryId] },
    });
    expect(res.status).toBe(422);
  });

  it("建立成功；categoryIds 重複值自動去重；無效 id → 422", async () => {
    const u = await user("sub-create-ok");
    const ok = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { keywords: ["腳踏車"], categoryIds: [categoryId, categoryId], cityIds: [cityId] },
    });
    expect(ok.status).toBe(201);
    const { id } = ok.json as { id: string };
    const stored = await db.subscriptionCategory.findMany({ where: { subscriptionId: id } });
    expect(stored).toHaveLength(1);

    const badRef = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { categoryIds: ["does-not-exist"] },
    });
    expect(badRef.status).toBe(422);
  });

  it("非本人 GET/PATCH/DELETE → 403；查無此訂閱 → 404", async () => {
    const owner = await user("sub-owner-403");
    const other = await user("sub-other-403");
    const created = await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId] },
    });
    const { id } = created.json as { id: string };

    expect((await api(`/api/subscriptions/${id}`, { user: other })).status).toBe(403);
    expect(
      (
        await api(`/api/subscriptions/${id}`, {
          method: "PATCH",
          user: other,
          body: { categoryIds: [categoryId] },
        })
      ).status,
    ).toBe(403);
    expect((await api(`/api/subscriptions/${id}`, { method: "DELETE", user: other })).status).toBe(
      403,
    );
    expect((await api("/api/subscriptions/does-not-exist", { user: owner })).status).toBe(404);
  });

  it("PATCH 整包替換語意：舊的 keywords/categories/cities 被換掉", async () => {
    const u = await user("sub-patch");
    const created = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { keywords: ["舊關鍵字"], categoryIds: [categoryId] },
    });
    const { id } = created.json as { id: string };

    const patched = await api(`/api/subscriptions/${id}`, {
      method: "PATCH",
      user: u,
      body: { keywords: ["新關鍵字"], cityIds: [cityId] },
    });
    expect(patched.status).toBe(200);

    const detail = await api(`/api/subscriptions/${id}`, { user: u });
    const body = detail.json as {
      keywords: { keyword: string }[];
      categories: unknown[];
      cities: { id: string }[];
    };
    expect(body.keywords.map((k) => k.keyword)).toEqual(["新關鍵字"]);
    expect(body.categories).toHaveLength(0);
    expect(body.cities.map((c) => c.id)).toEqual([cityId]);
  });

  it("DELETE 後查詢 404，cascade 清掉 keywords", async () => {
    const u = await user("sub-delete");
    const created = await api("/api/subscriptions", {
      method: "POST",
      user: u,
      body: { keywords: ["刪除測試"] },
    });
    const { id } = created.json as { id: string };
    expect((await api(`/api/subscriptions/${id}`, { method: "DELETE", user: u })).status).toBe(200);
    expect((await api(`/api/subscriptions/${id}`, { user: u })).status).toBe(404);
    expect(await db.subscriptionKeyword.findMany({ where: { subscriptionId: id } })).toHaveLength(
      0,
    );
  });

  it("GET 列表：cursor 分頁、帶累積命中數與未通知數", async () => {
    const u = await user("sub-list");
    for (let i = 0; i < 3; i++) {
      await api("/api/subscriptions", {
        method: "POST",
        user: u,
        body: { keywords: [`關鍵字${i}`] },
      });
    }
    const page1 = await api("/api/subscriptions?limit=2", { user: u });
    expect(page1.status).toBe(200);
    const body1 = page1.json as {
      subscriptions: { id: string; matchCount: number; pendingMatchCount: number }[];
      nextCursor: string | null;
    };
    expect(body1.subscriptions).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();
    for (const s of body1.subscriptions) {
      expect(s.matchCount).toBe(0);
      expect(s.pendingMatchCount).toBe(0);
    }
  });
});

// master-plan §6a 交付內容 5：正規化與比對邏輯是純函式，直接測。
describe("M6 關鍵字正規化與比對邏輯", () => {
  it("全形／半形、大小寫正規化後相同", () => {
    expect(normalizeKeyword("ｉＰhone")).toBe(normalizeKeyword("iphone"));
    expect(normalizeKeyword("ｉＰhone")).toBe("iphone");
  });

  it("子字串比對：關鍵字命中含有它的物品標題，不受大小寫/全形半形影響", () => {
    const normalizedItemText = normalizeKeyword("二手 iPhone 13 出售 功能正常");
    expect(normalizedItemText.includes(normalizeKeyword("iPhone"))).toBe(true);
    expect(normalizedItemText.includes(normalizeKeyword("ｉＰHONE"))).toBe(true);
  });

  it("isMatch：三維度內部 OR、跨維度 AND；未設定的維度視為不篩選", () => {
    const sub = {
      keywords: [{ normalizedKeyword: "腳踏車" }],
      categories: [{ categoryId: "cat-1" }],
      cities: [] as { cityId: string }[],
    };
    expect(isMatch(sub, { categoryId: "cat-1", cityId: "any" }, "二手腳踏車出售")).toBe(true);
    expect(isMatch(sub, { categoryId: "cat-2", cityId: "any" }, "二手腳踏車出售")).toBe(false);
    expect(isMatch(sub, { categoryId: "cat-1", cityId: "any" }, "二手機車出售")).toBe(false);
  });

  it("isMatch：某維度為空陣列時該維度永遠不篩選", () => {
    const sub = { keywords: [], categories: [], cities: [] };
    expect(isMatch(sub, { categoryId: "任何", cityId: "任何" }, "任何文字")).toBe(true);
  });
});

// master-plan §6a 交付內容 4、7、8：排程比對 job／每日摘要 job／idempotency。
describe("M6 排程比對 job 與每日摘要 job", () => {
  const userIds: string[] = [];
  let categoryId: string;
  let cityId: string;

  beforeAll(async () => {
    ({ categoryId, cityId } = await pickCityAndCategory());
    expect(CRON_SECRET).toBeTruthy();
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("CRON_SECRET 錯誤或缺少 → 401（兩支 job 都要擋）", async () => {
    expect((await callJob("/api/jobs/subscription-match-scan", "wrong")).status).toBe(401);
    expect((await callJob("/api/jobs/subscription-match-scan", null)).status).toBe(401);
    expect((await callJob("/api/jobs/subscription-daily-digest", "wrong")).status).toBe(401);
  });

  it("immediateEnabled=true 訂閱命中 → 立刻通知；重複觸發（cursor 未推進）不重複", async () => {
    const owner = await user("scan-immediate-owner");
    const subRes = await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], immediateEnabled: true, dailyDigestEnabled: false },
    });
    expect(subRes.status).toBe(201);
    const { id: subscriptionId } = subRes.json as { id: string };

    const itemId = await createPublishedItem(owner, { categoryId, cityId });

    const firstRun = await callJob("/api/jobs/subscription-match-scan");
    expect(firstRun.status).toBe(200);

    const match = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId } },
    });
    expect(match.notifiedAt).not.toBeNull();
    expect(match.notifiedVia).toBe("immediate");

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(kindsOf(notifications).filter((k) => k === "subscription_match")).toHaveLength(1);

    // idempotency：模擬「cursor 未推進被重複觸發」——把最近一次成功 run 的 cursor 撥回
    // 這個物品之前，讓下一次 tick 把同一個物品當成候選再掃一次。
    const job = await db.systemJob.findUniqueOrThrow({
      where: { key: "subscription_match_scan" },
    });
    const lastRun = await db.systemJobRun.findFirstOrThrow({
      where: { jobId: job.id, status: "success" },
      orderBy: { startedAt: "desc" },
    });
    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    await db.systemJobRun.update({
      where: { id: lastRun.id },
      data: {
        detail: {
          cursor: {
            publishedAt: new Date(item.publishedAt!.getTime() - 1).toISOString(),
            id: "",
          },
        },
      },
    });

    const secondRun = await callJob("/api/jobs/subscription-match-scan");
    expect(secondRun.status).toBe(200);
    expect((secondRun.json as { matchedCount: number }).matchedCount).toBe(0);

    const matchesAfter = await db.subscriptionMatch.findMany({
      where: { subscriptionId, itemId },
    });
    expect(matchesAfter).toHaveLength(1);
    const notificationsAfter = await db.notification.findMany({ where: { userId: owner.id } });
    expect(kindsOf(notificationsAfter).filter((k) => k === "subscription_match")).toHaveLength(1);
  });

  it("dailyDigestEnabled 訂閱：先不通知，摘要 job 才通知；同一天重複觸發摘要 job 不重複發送", async () => {
    const owner = await user("digest-owner");
    const subRes = await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], immediateEnabled: false, dailyDigestEnabled: true },
    });
    const { id: subscriptionId } = subRes.json as { id: string };
    const itemId = await createPublishedItem(owner, { categoryId, cityId });

    await callJob("/api/jobs/subscription-match-scan");

    const matchAfterScan = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId } },
    });
    expect(matchAfterScan.notifiedAt).toBeNull();
    expect(
      kindsOf(await db.notification.findMany({ where: { userId: owner.id } })).filter(
        (k) => k === "subscription_match" || k === "subscription_digest",
      ),
    ).toHaveLength(0);

    const firstDigest = await callJob("/api/jobs/subscription-daily-digest");
    expect(firstDigest.status).toBe(200);
    expect((firstDigest.json as { sentCount: number }).sentCount).toBeGreaterThanOrEqual(1);

    const matchAfterDigest = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId } },
    });
    expect(matchAfterDigest.notifiedAt).not.toBeNull();
    expect(matchAfterDigest.notifiedVia).toBe("digest");
    expect(matchAfterDigest.digestJobId).not.toBeNull();

    const digestJob = await db.subscriptionDigestJob.findUniqueOrThrow({
      where: { id: matchAfterDigest.digestJobId! },
    });
    expect(digestJob.status).toBe("sent");
    expect(digestJob.itemCount).toBeGreaterThanOrEqual(1);

    const notificationsAfterFirst = await db.notification.findMany({
      where: { userId: owner.id },
    });
    expect(
      kindsOf(notificationsAfterFirst).filter((k) => k === "subscription_digest"),
    ).toHaveLength(1);

    // 模擬「今天稍晚又出現一筆待通知的 match」：今天的摘要已經 sent，理論上這筆要等明天的
    // 摘要 job 才會被撿走——用來驗證 processUserDigest 撞到 status='sent' 時是整個跳過
    // （不會偷偷把這筆新 match 也蓋章處理掉）。
    const secondItemId = await createPublishedItem(owner, { categoryId, cityId });
    await db.subscriptionMatch.create({
      data: { subscriptionId, itemId: secondItemId },
    });

    // 重複觸發：idempotent，同一天不重複發送
    const secondDigest = await callJob("/api/jobs/subscription-daily-digest");
    expect(secondDigest.status).toBe(200);
    expect(
      (secondDigest.json as { alreadyDoneCount: number }).alreadyDoneCount,
    ).toBeGreaterThanOrEqual(1);

    const digestJobsAfter = await db.subscriptionDigestJob.findMany({
      where: { userId: owner.id },
    });
    expect(digestJobsAfter).toHaveLength(1);
    expect(digestJobsAfter[0].status).toBe("sent");
    const notificationsAfterSecond = await db.notification.findMany({
      where: { userId: owner.id },
    });
    expect(
      kindsOf(notificationsAfterSecond).filter((k) => k === "subscription_digest"),
    ).toHaveLength(1);

    // 今天已經處理過，這筆新 match 完全不被動到，留給明天的摘要 job。
    const secondMatch = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId: secondItemId } },
    });
    expect(secondMatch.notifiedAt).toBeNull();
  });

  it("摘要撈到的 match 若物品已不是 published → 仍蓋章 notifiedAt，但不出現在摘要內容", async () => {
    const owner = await user("digest-stale-owner");
    const receiver = await user("digest-stale-receiver");
    const subRes = await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], dailyDigestEnabled: true },
    });
    const { id: subscriptionId } = subRes.json as { id: string };
    const itemId = await createPublishedItem(owner, { categoryId, cityId });

    await callJob("/api/jobs/subscription-match-scan");

    // 物品在摘要 job 執行之前被別人搶先認領走，狀態變成 reserved。
    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claimRes.status).toBe(201);

    const digestRun = await callJob("/api/jobs/subscription-daily-digest");
    expect(digestRun.status).toBe(200);

    const match = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId } },
    });
    expect(match.notifiedAt).not.toBeNull();
    expect(match.notifiedVia).toBe("digest");

    const digestNotification = (
      await db.notification.findMany({ where: { userId: owner.id } })
    ).find((n) => (n.payload as { kind?: string }).kind === "subscription_digest");
    if (digestNotification) {
      const items = (digestNotification.payload as { items?: { itemId: string }[] }).items ?? [];
      expect(items.some((i) => i.itemId === itemId)).toBe(false);
    }
  });

  it("即時＋每日摘要同時開啟：只收到一次通知（即時那次），之後不會被摘要 job 重複處理", async () => {
    const owner = await user("both-enabled-owner");
    await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], immediateEnabled: true, dailyDigestEnabled: true },
    });
    await createPublishedItem(owner, { categoryId, cityId });

    await callJob("/api/jobs/subscription-match-scan");
    await callJob("/api/jobs/subscription-daily-digest");

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(kindsOf(notifications).filter((k) => k === "subscription_match")).toHaveLength(1);
    expect(kindsOf(notifications).filter((k) => k === "subscription_digest")).toHaveLength(0);

    // 這個使用者沒有任何待通知的 match，摘要 job 不會替他建立 digest job 列。
    const digestJobs = await db.subscriptionDigestJob.findMany({ where: { userId: owner.id } });
    expect(digestJobs).toHaveLength(0);
  });

  it("通知偏好 externalEnabled=false → 仍有站內通知，但不建立 web_push delivery 紀錄", async () => {
    const owner = await user("pref-external-off-owner");
    const prefRes = await api("/api/notification-preferences", {
      method: "PATCH",
      user: owner,
      body: { eventType: "subscription_match", externalEnabled: false },
    });
    expect(prefRes.status).toBe(200);

    await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], immediateEnabled: true, dailyDigestEnabled: false },
    });
    await createPublishedItem(owner, { categoryId, cityId });

    await callJob("/api/jobs/subscription-match-scan");

    const notification = (await db.notification.findMany({ where: { userId: owner.id } })).find(
      (n) => (n.payload as { kind?: string }).kind === "subscription_match",
    );
    expect(notification).toBeDefined();

    const deliveries = await db.notificationDelivery.findMany({
      where: { channel: "web_push", notification: { userId: owner.id } },
    });
    expect(deliveries).toHaveLength(0);
  });

  it("inAppEnabled=false → 不建立站內通知，但比對命中仍蓋章 notifiedAt（時機判斷跟通知建立是正交的兩層閘門）", async () => {
    const owner = await user("pref-inapp-off-owner");
    const prefRes = await api("/api/notification-preferences", {
      method: "PATCH",
      user: owner,
      body: { eventType: "subscription_match", inAppEnabled: false },
    });
    expect(prefRes.status).toBe(200);

    const subRes = await api("/api/subscriptions", {
      method: "POST",
      user: owner,
      body: { categoryIds: [categoryId], immediateEnabled: true, dailyDigestEnabled: false },
    });
    const { id: subscriptionId } = subRes.json as { id: string };
    const itemId = await createPublishedItem(owner, { categoryId, cityId });

    await callJob("/api/jobs/subscription-match-scan");

    const match = await db.subscriptionMatch.findUniqueOrThrow({
      where: { subscriptionId_itemId: { subscriptionId, itemId } },
    });
    expect(match.notifiedAt).not.toBeNull();
    expect(match.notifiedVia).toBe("immediate");

    const notifications = await db.notification.findMany({ where: { userId: owner.id } });
    expect(kindsOf(notifications).filter((k) => k === "subscription_match")).toHaveLength(0);
  });
});

// master-plan §6a 交付內容 3、9：Web Push 訂閱端點。
describe("M6 Web Push 訂閱端點", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("未登入 → 401", async () => {
    expect((await api("/api/web-push/subscriptions", { method: "POST" })).status).toBe(401);
    expect((await api("/api/web-push/subscriptions", { method: "DELETE" })).status).toBe(401);
  });

  it("建立→同一 endpoint 重新訂閱會 upsert 復活（不是產生重複列）→ 刪除→非本人刪除回 404", async () => {
    const owner = await user("push-owner");
    const other = await user("push-other");
    const endpoint = `https://push.example.test/${owner.id}-endpoint`;

    const first = await api("/api/web-push/subscriptions", {
      method: "POST",
      user: owner,
      body: { endpoint, keys: { p256dh: "p", auth: "a" } },
    });
    expect(first.status).toBe(201);

    const second = await api("/api/web-push/subscriptions", {
      method: "POST",
      user: owner,
      body: { endpoint, keys: { p256dh: "p2", auth: "a2" } },
    });
    expect(second.status).toBe(201);

    const rows = await db.webPushSubscription.findMany({ where: { endpoint } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].p256dhKey).toBe("p2");

    const deleteByOther = await api("/api/web-push/subscriptions", {
      method: "DELETE",
      user: other,
      body: { endpoint },
    });
    expect(deleteByOther.status).toBe(404);

    const deleteByOwner = await api("/api/web-push/subscriptions", {
      method: "DELETE",
      user: owner,
      body: { endpoint },
    });
    expect(deleteByOwner.status).toBe(200);
    expect(await db.webPushSubscription.findUnique({ where: { endpoint } })).toBeNull();
  });

  it("缺少 endpoint 或金鑰 → 422", async () => {
    const owner = await user("push-invalid");
    const res = await api("/api/web-push/subscriptions", {
      method: "POST",
      user: owner,
      body: { endpoint: "" },
    });
    expect(res.status).toBe(422);
  });
});

// master-plan §6a 交付內容 4「關鍵前提」：物品從 reserved/handover_pending/
// removed_by_moderator 退回 published 時必須更新 publishedAt，否則訂閱比對 job 的 cursor
// 永遠掃不到「重新上架」的物品。
describe("M6 關鍵前提：物品退回 published 時 publishedAt 要更新", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("no-show 讓物品從 handover_pending 退回 published 時，publishedAt 會被重蓋成現在", async () => {
    const owner = await user("no-show-publishedat-owner");
    const receiver = await user("no-show-publishedat-receiver");
    const itemId = await createPublishedItem(owner);

    const before = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    const originalPublishedAt = before.publishedAt!;

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

    const handover = await db.handoverRecord.findFirstOrThrow({ where: { itemId } });
    // 等 1ms 確保新的 publishedAt 在時間戳上真的比原本晚（避免同一毫秒巧合造成偽陽性）。
    await new Promise((resolve) => setTimeout(resolve, 5));
    const noShowRes = await api(`/api/handover/${handover.id}/no-show`, {
      method: "PATCH",
      user: owner,
    });
    expect(noShowRes.status).toBe(200);

    const after = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(after.status).toBe("published");
    expect(after.publishedAt!.getTime()).toBeGreaterThan(originalPublishedAt.getTime());
  });
});
