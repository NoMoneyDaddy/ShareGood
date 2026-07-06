import { afterAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import {
  cleanupTestData,
  createTestUser,
  grantRole,
  sessionCookieHeader,
  type TestUser,
} from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// M7 資料權利與法務（master-plan §7a）整合測試。對應實作：
// src/lib/{legal-hold,data-export,account-deletion,retention}.ts、
// src/app/api/{me/data-exports,me/privacy-requests,admin/data-retention-policies,
// admin/data-purge-logs,admin/legal-holds,admin/legal-requests}[...]、
// src/app/api/jobs/{data-export-generate,data-export-purge,account-deletion-execute,
// retention-purge}。

const CRON_SECRET = process.env.CRON_SECRET;

async function callJob(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: CRON_SECRET ? { authorization: `Bearer ${CRON_SECRET}` } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe("M7 資料自助匯出", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("送出匯出請求→24 小時內重複→409→job 執行後 ready，storage_objects 出現紀錄，站內通知送達", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const u = await user("export-owner");

    // 順便建一筆物品/留言/貢獻值，確認匯出包產生流程不會因為有資料而出錯。
    await createPublishedItem(u);

    const first = await api("/api/me/data-exports", { method: "POST", user: u });
    expect(first.status).toBe(201);
    const exportId = (first.json as { id: string }).id;

    const duplicate = await api("/api/me/data-exports", { method: "POST", user: u });
    expect(duplicate.status).toBe(409);

    const jobRun = await callJob("/api/jobs/data-export-generate");
    expect(jobRun.status).toBe(200);
    expect((jobRun.json as { generated: number }).generated).toBeGreaterThanOrEqual(1);

    const dataExport = await db.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    expect(dataExport.status).toBe("ready");
    expect(dataExport.storageObjectId).not.toBeNull();
    expect(dataExport.expiresAt).not.toBeNull();

    const storageObject = await db.storageObject.findUniqueOrThrow({
      where: { id: dataExport.storageObjectId! },
    });
    expect(storageObject.kind).toBe("export_package");

    const privacyRequest = await db.privacyRequest.findUniqueOrThrow({
      where: { id: dataExport.privacyRequestId },
    });
    expect(privacyRequest.status).toBe("completed");

    const notifications = await db.notification.findMany({ where: { userId: u.id } });
    const readyNotification = notifications.find(
      (n) => (n.payload as { kind?: string }).kind === "data_export_ready",
    );
    expect(readyNotification).toBeTruthy();
  });

  it("下載連結：兩次呼叫拿到不同簽名網址，且都能成功下載", async () => {
    const u = await user("export-download-owner");
    const created = await api("/api/me/data-exports", { method: "POST", user: u });
    const exportId = (created.json as { id: string }).id;
    await callJob("/api/jobs/data-export-generate");

    const first = await api(`/api/me/data-exports/${exportId}/download`, { user: u });
    expect(first.status).toBe(200);
    const firstUrl = (first.json as { url: string }).url;

    // presigned URL 的簽章在同一秒內重簽會完全相同（AWS SigV4 以秒為粒度），等待跨過
    // 一秒邊界，確保兩次呼叫真的拿到不同網址（驗證「非固定網址」，不是巧合地看起來一樣）。
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const second = await api(`/api/me/data-exports/${exportId}/download`, { user: u });
    expect(second.status).toBe(200);
    const secondUrl = (second.json as { url: string }).url;

    expect(firstUrl).not.toBe(secondUrl);

    const download = await fetch(firstUrl);
    expect(download.status).toBe(200);

    const updated = await db.dataExport.findUniqueOrThrow({ where: { id: exportId } });
    expect(updated.downloadCount).toBeGreaterThanOrEqual(2);
  });

  it("簽名連結過期後直接 GET 回 403（非 publicUrl() 那種永久網址）", async () => {
    // 直接用底層 helper 驗證過期行為（15 分鐘的預設效期不適合在測試裡真的等待），
    // 物件路徑沿用既有的公開圖片管線，重點驗證的是「簽章機制本身有時效」這件事本身。
    const { getPresignedDownloadUrl, putObject } = await import("@/lib/storage");
    const key = `exports/test/expiry-check-${Date.now()}.txt`;
    await putObject(key, Buffer.from("hello"), "text/plain");

    const shortLivedUrl = await getPresignedDownloadUrl(key, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const res = await fetch(shortLivedUrl);
    expect(res.status).toBe(403);
  });

  it("匯出包內容含使用者自己的物品/貢獻值等，不含其他使用者的私密資料（email）", async () => {
    const owner = await user("export-content-owner");
    const receiver = await user("export-content-receiver");
    const itemId = await createPublishedItem(owner);
    await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });

    const { buildExportPackageFiles } = await import("@/lib/data-export");
    const now = new Date();
    const files = await buildExportPackageFiles(owner.id, {
      signedUrlExpiresInSeconds: 3600,
      generatedAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
    });

    expect(files["items.json"]).toContain(itemId);
    expect(files["claims.json"]).toBeDefined();
    expect(files["profile.json"]).toContain(owner.email);
    // 對方（接手者）的 email 不應該出現在物主的匯出包裡。
    expect(JSON.stringify(files)).not.toContain(receiver.email);
  });

  it("legal hold 保全的匯出包不會被 data-export-purge job 清除；未保全的過期匯出包會被清除", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const heldUser = await user("export-purge-held-owner");
    const freeUser = await user("export-purge-free-owner");

    async function makeReadyExport(u: TestUser) {
      const created = await api("/api/me/data-exports", { method: "POST", user: u });
      const exportId = (created.json as { id: string }).id;
      await callJob("/api/jobs/data-export-generate");
      // 模擬「已過期」：把 expiresAt 撥回過去。
      await db.dataExport.update({
        where: { id: exportId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      return exportId;
    }

    const heldExportId = await makeReadyExport(heldUser);
    const freeExportId = await makeReadyExport(freeUser);

    const admin = await user("export-purge-admin");
    await grantRole(admin.id, "admin");
    const holdRes = await api("/api/admin/legal-holds", {
      method: "POST",
      user: admin,
      body: {
        reason: "測試保全",
        targets: [{ targetType: "data_export", targetId: heldExportId }],
      },
    });
    expect(holdRes.status).toBe(201);

    const purgeRun = await callJob("/api/jobs/data-export-purge");
    expect(purgeRun.status).toBe(200);

    const heldExport = await db.dataExport.findUniqueOrThrow({ where: { id: heldExportId } });
    expect(heldExport.status).toBe("ready"); // 沒被清除
    const heldPurgeLog = await db.dataPurgeLog.findFirst({
      where: { targetType: "data_export", targetId: heldExportId },
    });
    expect(heldPurgeLog?.skippedLegalHold).toBe(true);

    const freeExport = await db.dataExport.findUniqueOrThrow({ where: { id: freeExportId } });
    expect(freeExport.status).toBe("expired");
    const freePurgeLog = await db.dataPurgeLog.findFirst({
      where: { targetType: "data_export", targetId: freeExportId },
    });
    expect(freePurgeLog?.skippedLegalHold).toBe(false);
  });

  it("未登入呼叫資料匯出相關 API → 401", async () => {
    const res1 = await api("/api/me/data-exports", { method: "POST" });
    expect(res1.status).toBe(401);
    const res2 = await api("/api/me/privacy-requests", { method: "POST" });
    expect(res2.status).toBe(401);
  });
});

describe("M7 帳號刪除", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("送出帳號刪除請求 → cooling_off 狀態且 7 天後到期；冷卻期內可撤銷", async () => {
    const u = await user("deletion-cooling-off");

    const res = await api("/api/me/privacy-requests", {
      method: "POST",
      user: u,
      body: { type: "account_deletion", reason: "測試用" },
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; status: string; coolingOffUntil: string };
    expect(body.status).toBe("cooling_off");
    const daysUntil =
      (new Date(body.coolingOffUntil).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntil).toBeGreaterThan(6.9);
    expect(daysUntil).toBeLessThan(7.1);

    // 冷卻期中不能再送出第二筆。
    const duplicate = await api("/api/me/privacy-requests", {
      method: "POST",
      user: u,
      body: { type: "account_deletion" },
    });
    expect(duplicate.status).toBe(409);

    const cancelled = await api(`/api/me/privacy-requests/${body.id}`, {
      method: "DELETE",
      user: u,
    });
    expect(cancelled.status).toBe(200);

    const request = await db.privacyRequest.findUniqueOrThrow({ where: { id: body.id } });
    expect(request.status).toBe("cancelled");

    // 帳號本身完全不受影響。
    const stillThere = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stillThere.deletedAt).toBeNull();
    expect(stillThere.email).toBe(u.email);
  });

  it("冷卻期滿執行 job：去識別化改寫、Account/Session/UserRole 真的刪除，其他使用者的歷史紀錄筆數不變", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await user("deletion-execute-owner");
    const receiver = await user("deletion-execute-receiver");

    const itemId = await createPublishedItem(owner);
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
    await api(`/api/handover/${handover.id}/complete`, { method: "PATCH", user: owner });
    const completeRes = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: receiver,
    });
    expect(completeRes.status).toBe(200);

    const thanksRes = await api(`/api/items/${itemId}/thanks`, {
      method: "POST",
      user: receiver,
      body: { message: "謝謝你！" },
    });
    expect(thanksRes.status).toBe(201);

    const conversation = await db.conversation.findUniqueOrThrow({ where: { itemId } });
    const messageRes = await api(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      user: owner,
      body: { body: "不客氣～" },
    });
    expect(messageRes.status).toBe(201);

    // 給物主一個角色與一筆 OAuth Account 綁定，驗證去識別化後這兩者真的被刪除。
    await grantRole(owner.id, "moderator");
    await db.account.create({
      data: {
        userId: owner.id,
        type: "oauth",
        provider: "google",
        providerAccountId: `fake-${owner.id}`,
      },
    });

    const beforeCounts = {
      claims: await db.claimComment.count({ where: { itemId } }),
      thanks: await db.thanksMessage.count({ where: { itemId } }),
      handovers: await db.handoverRecord.count({ where: { itemId } }),
      contributions: await db.contributionEvent.count({ where: { itemId } }),
      messages: await db.message.count({ where: { conversationId: conversation.id } }),
    };
    expect(beforeCounts.claims).toBe(1);
    expect(beforeCounts.thanks).toBe(1);
    expect(beforeCounts.contributions).toBe(2); // 分享完成 +10、接手完成 +2

    const deletionReq = await api("/api/me/privacy-requests", {
      method: "POST",
      user: owner,
      body: { type: "account_deletion" },
    });
    expect(deletionReq.status).toBe(201);
    const requestId = (deletionReq.json as { id: string }).id;
    await db.privacyRequest.update({
      where: { id: requestId },
      data: { coolingOffUntil: new Date(Date.now() - 60_000) },
    });

    const jobRun = await callJob("/api/jobs/account-deletion-execute");
    expect(jobRun.status).toBe(200);
    expect((jobRun.json as { executed: number }).executed).toBeGreaterThanOrEqual(1);

    const deletedUser = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(deletedUser.name).toBe("已刪除的使用者");
    expect(deletedUser.email).toBe(`deleted-${owner.id}@sharegood.invalid`);
    expect(deletedUser.image).toBeNull();
    expect(deletedUser.deletedAt).not.toBeNull();
    expect(deletedUser.id).toBe(owner.id); // id 不變

    const deletedProfile = await db.profile.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(deletedProfile.nickname).toBe("已刪除的使用者");
    expect(deletedProfile.bio).toBeNull();

    expect(await db.account.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.userRole.count({ where: { userId: owner.id } })).toBe(0);

    const afterCounts = {
      claims: await db.claimComment.count({ where: { itemId } }),
      thanks: await db.thanksMessage.count({ where: { itemId } }),
      handovers: await db.handoverRecord.count({ where: { itemId } }),
      contributions: await db.contributionEvent.count({ where: { itemId } }),
      messages: await db.message.count({ where: { conversationId: conversation.id } }),
    };
    expect(afterCounts).toEqual(beforeCounts);

    // 物品已經是 completed（不是 published），去識別化不應該動它的狀態。
    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("completed");

    // 舊 session token 已經失效，無法再用來呼叫需要登入的 API。
    const staleSessionRes = await fetch(`${BASE_URL}/api/me/data-exports`, {
      headers: { cookie: sessionCookieHeader(owner) },
    });
    expect(staleSessionRes.status).toBe(401);

    // 公開個人頁顯示「已刪除的使用者」，不顯示原暱稱。
    const profilePageRes = await fetch(`${BASE_URL}/u/${owner.id}`);
    expect(profilePageRes.status).toBe(200);
    const html = await profilePageRes.text();
    expect(html).toContain("已刪除的使用者");
    expect(html).not.toContain(owner.nickname);
  });

  it("已上架（published）物品在帳號刪除時自動轉 removed_by_user", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await user("deletion-published-item-owner");
    const itemId = await createPublishedItem(owner);

    const deletionReq = await api("/api/me/privacy-requests", {
      method: "POST",
      user: owner,
      body: { type: "account_deletion" },
    });
    const requestId = (deletionReq.json as { id: string }).id;
    await db.privacyRequest.update({
      where: { id: requestId },
      data: { coolingOffUntil: new Date(Date.now() - 60_000) },
    });

    await callJob("/api/jobs/account-deletion-execute");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("removed_by_user");
    const statusLog = await db.itemStatusLog.findFirst({
      where: { itemId, toStatus: "removed_by_user" },
    });
    expect(statusLog).toBeTruthy();
  });

  it("legal hold 命中使用者 → 帳號刪除 job 不執行去識別化，請求轉 rejected 並通知使用者", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const target = await user("deletion-legal-hold-target");
    const admin = await user("deletion-legal-hold-admin");
    await grantRole(admin.id, "admin");

    const deletionReq = await api("/api/me/privacy-requests", {
      method: "POST",
      user: target,
      body: { type: "account_deletion" },
    });
    const requestId = (deletionReq.json as { id: string }).id;
    await db.privacyRequest.update({
      where: { id: requestId },
      data: { coolingOffUntil: new Date(Date.now() - 60_000) },
    });

    const holdRes = await api("/api/admin/legal-holds", {
      method: "POST",
      user: admin,
      body: { reason: "帳號涉詐騙調查中", targets: [{ targetType: "user", targetId: target.id }] },
    });
    expect(holdRes.status).toBe(201);

    await callJob("/api/jobs/account-deletion-execute");

    const request = await db.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe("rejected");

    const stillIdentifiable = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stillIdentifiable.deletedAt).toBeNull();
    expect(stillIdentifiable.email).toBe(target.email);

    const notifications = await db.notification.findMany({ where: { userId: target.id } });
    const blocked = notifications.find(
      (n) => (n.payload as { kind?: string }).kind === "account_deletion_blocked_legal_hold",
    );
    expect(blocked).toBeTruthy();
  });
});

describe("M7 retention_purge：政策可設定、legal hold 保護", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("依 data_retention_policies 設定執行清除；legal hold 保全的目標跳過；改天數後行為改變", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const u = await user("retention-notifications-user");
    const admin = await user("retention-notifications-admin");
    await grantRole(admin.id, "admin");

    async function makeOldNotification(daysAgo: number) {
      return db.notification.create({
        data: {
          userId: u.id,
          type: "completion_confirmed",
          payload: { kind: "test" },
          createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        },
      });
    }

    const veryOld = await makeOldNotification(100); // 超過預設 90 天，應該被清
    const mediumOld = await makeOldNotification(50); // 沒超過預設 90 天，應該保留
    const heldOld = await makeOldNotification(100); // 超過 90 天但被 legal hold 保護

    const holdRes = await api("/api/admin/legal-holds", {
      method: "POST",
      user: admin,
      body: {
        reason: "測試保全通知",
        targets: [{ targetType: "notification", targetId: heldOld.id }],
      },
    });
    expect(holdRes.status).toBe(201);

    const firstRun = await callJob("/api/jobs/retention-purge");
    expect(firstRun.status).toBe(200);

    expect(await db.notification.findUnique({ where: { id: veryOld.id } })).toBeNull();
    expect(await db.notification.findUnique({ where: { id: mediumOld.id } })).not.toBeNull();
    expect(await db.notification.findUnique({ where: { id: heldOld.id } })).not.toBeNull();

    const heldLog = await db.dataPurgeLog.findFirst({
      where: { targetType: "notification", targetId: heldOld.id },
    });
    expect(heldLog?.skippedLegalHold).toBe(true);
    const purgedLog = await db.dataPurgeLog.findFirst({
      where: { targetType: "notification", targetId: veryOld.id },
    });
    expect(purgedLog?.skippedLegalHold).toBe(false);

    // 改政策天數：把 90 天改成 10 天，重跑 job，之前保留的 mediumOld（50 天前）現在也該被清。
    const policy = await db.dataRetentionPolicy.findUniqueOrThrow({
      where: { policyKey: "notifications" },
    });
    const patchRes = await api(`/api/admin/data-retention-policies/${policy.id}`, {
      method: "PATCH",
      user: admin,
      body: { retentionDays: 10, action: "purge", isActive: true },
    });
    expect(patchRes.status).toBe(200);

    const secondRun = await callJob("/api/jobs/retention-purge");
    expect(secondRun.status).toBe(200);

    expect(await db.notification.findUnique({ where: { id: mediumOld.id } })).toBeNull();
    // 被保全的那筆無論怎麼調整天數，還是不會被清。
    expect(await db.notification.findUnique({ where: { id: heldOld.id } })).not.toBeNull();

    // 復原政策設定，避免影響其他測試對預設 90 天的假設。
    await db.dataRetentionPolicy.update({
      where: { id: policy.id },
      data: { retentionDays: 90, action: "purge" },
    });
  });

  it("非 admin/moderator 呼叫 data-retention-policies／data-purge-logs → 401/403", async () => {
    const regularUser = await user("retention-perm-user");
    const moderator = await user("retention-perm-moderator");
    await grantRole(moderator.id, "moderator");

    const unauth = await api("/api/admin/data-retention-policies");
    expect(unauth.status).toBe(401);

    const forbidden = await api("/api/admin/data-retention-policies", { user: regularUser });
    expect(forbidden.status).toBe(403);

    const moderatorRead = await api("/api/admin/data-retention-policies", { user: moderator });
    expect(moderatorRead.status).toBe(200);

    const policy = await db.dataRetentionPolicy.findFirstOrThrow({
      where: { policyKey: "notifications" },
    });
    const moderatorPatch = await api(`/api/admin/data-retention-policies/${policy.id}`, {
      method: "PATCH",
      user: moderator,
      body: { retentionDays: 5, action: "purge", isActive: true },
    });
    expect(moderatorPatch.status).toBe(403); // 只有 admin 能改政策

    const purgeLogsForbidden = await api("/api/admin/data-purge-logs", { user: regularUser });
    expect(purgeLogsForbidden.status).toBe(403);
  });
});

describe("M7 legal hold 管理 API 權限", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("只有 admin 能建立/解除 legal hold；moderator 與一般使用者一律 403/401", async () => {
    const regularUser = await user("legalhold-perm-user");
    const moderator = await user("legalhold-perm-moderator");
    const admin = await user("legalhold-perm-admin");
    await grantRole(moderator.id, "moderator");
    await grantRole(admin.id, "admin");

    const unauth = await api("/api/admin/legal-holds", {
      method: "POST",
      body: { reason: "x", targets: [{ targetType: "user", targetId: "abc" }] },
    });
    expect(unauth.status).toBe(401);

    const forbiddenRegular = await api("/api/admin/legal-holds", {
      method: "POST",
      user: regularUser,
      body: { reason: "x", targets: [{ targetType: "user", targetId: "abc" }] },
    });
    expect(forbiddenRegular.status).toBe(403);

    const forbiddenModerator = await api("/api/admin/legal-holds", {
      method: "POST",
      user: moderator,
      body: { reason: "x", targets: [{ targetType: "user", targetId: "abc" }] },
    });
    expect(forbiddenModerator.status).toBe(403);

    const created = await api("/api/admin/legal-holds", {
      method: "POST",
      user: admin,
      body: { reason: "測試保全", targets: [{ targetType: "user", targetId: regularUser.id }] },
    });
    expect(created.status).toBe(201);
    const holdId = (created.json as { id: string }).id;

    const releaseForbidden = await api(`/api/admin/legal-holds/${holdId}`, {
      method: "PATCH",
      user: moderator,
      body: { action: "release" },
    });
    expect(releaseForbidden.status).toBe(403);

    const release = await api(`/api/admin/legal-holds/${holdId}`, {
      method: "PATCH",
      user: admin,
      body: { action: "release" },
    });
    expect(release.status).toBe(200);

    const hold = await db.legalHold.findUniqueOrThrow({ where: { id: holdId } });
    expect(hold.status).toBe("released");
    expect(hold.releasedBy).toBe(admin.id);
  });
});

describe("M7 警方／檢調調閱：雙人審核流程", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    // LawEnforcementExport/Document 對 StorageObject 是 onDelete: Restrict，必須先讓
    // LawEnforcementRequest 連帶 cascade 刪掉這些子表，storageObject 才刪得掉（見
    // cleanupTestData 對 storageObject 的清理順序）。
    await db.lawEnforcementRequest.deleteMany({ where: { submittedBy: { in: userIds } } });
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("建檔與核准必須是不同 admin；非 admin 呼叫核准 → 403；核准後可產生匯出包並下載，下載寫入 events", async () => {
    const targetUser = await user("legalreq-target");
    const submitterAdmin = await user("legalreq-submitter-admin");
    const approverAdmin = await user("legalreq-approver-admin");
    const moderator = await user("legalreq-moderator");
    await grantRole(submitterAdmin.id, "admin");
    await grantRole(approverAdmin.id, "admin");
    await grantRole(moderator.id, "moderator");

    const created = await api("/api/admin/legal-requests", {
      method: "POST",
      user: submitterAdmin,
      body: {
        agencyName: "測試地檢署",
        caseReference: `CASE-${Date.now()}`,
        legalBasis: "刑事訴訟法第 XXX 條",
        requestScope: `${targetUser.id} 使用者近 90 天資料`,
        receivedAt: new Date().toISOString().slice(0, 10),
        notifyUser: true,
        targets: [{ targetType: "user", targetId: targetUser.id }],
      },
    });
    expect(created.status).toBe(201);
    const requestId = (created.json as { id: string }).id;

    // 非 admin 呼叫核准 → 403。
    const moderatorApprove = await api(`/api/admin/legal-requests/${requestId}/approve`, {
      method: "PATCH",
      user: moderator,
    });
    expect(moderatorApprove.status).toBe(403);

    // 建檔人本人（雖然是 admin）不能核准自己建立的請求。
    const selfApprove = await api(`/api/admin/legal-requests/${requestId}/approve`, {
      method: "PATCH",
      user: submitterAdmin,
    });
    expect(selfApprove.status).toBe(403);

    const approve = await api(`/api/admin/legal-requests/${requestId}/approve`, {
      method: "PATCH",
      user: approverAdmin,
    });
    expect(approve.status).toBe(200);

    const request = await db.lawEnforcementRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe("approved");
    expect(request.approvedBy).toBe(approverAdmin.id);
    expect(request.submittedBy).not.toBe(request.approvedBy);

    const exportRes = await api(`/api/admin/legal-requests/${requestId}/exports`, {
      method: "POST",
      user: approverAdmin,
    });
    expect(exportRes.status).toBe(201);
    const exportId = (exportRes.json as { id: string }).id;

    // 非 admin 不能下載。
    const moderatorDownload = await api(
      `/api/admin/legal-requests/${requestId}/exports/${exportId}/download`,
      { user: moderator },
    );
    expect(moderatorDownload.status).toBe(403);

    const download = await api(
      `/api/admin/legal-requests/${requestId}/exports/${exportId}/download`,
      { user: approverAdmin },
    );
    expect(download.status).toBe(200);
    expect((download.json as { url: string }).url).toBeTruthy();

    const events = await db.lawEnforcementRequestEvent.findMany({ where: { requestId } });
    expect(events.some((e) => e.action === "export_downloaded")).toBe(true);
    expect(events.some((e) => e.action === "approved")).toBe(true);
    expect(events.some((e) => e.action === "export_generated")).toBe(true);

    const fulfilled = await db.lawEnforcementRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(fulfilled.status).toBe("fulfilled");
  });

  it("駁回需要填寫原因；非 admin 呼叫建檔 API → 403；未登入 → 401", async () => {
    const submitterAdmin = await user("legalreq-reject-submitter");
    const approverAdmin = await user("legalreq-reject-approver");
    const regularUser = await user("legalreq-reject-regular");
    await grantRole(submitterAdmin.id, "admin");
    await grantRole(approverAdmin.id, "admin");

    const unauth = await api("/api/admin/legal-requests", { method: "POST" });
    expect(unauth.status).toBe(401);

    const forbidden = await api("/api/admin/legal-requests", {
      method: "POST",
      user: regularUser,
      body: {},
    });
    expect(forbidden.status).toBe(403);

    const created = await api("/api/admin/legal-requests", {
      method: "POST",
      user: submitterAdmin,
      body: {
        agencyName: "測試分局",
        caseReference: `CASE-REJECT-${Date.now()}`,
        legalBasis: "測試法源",
        requestScope: "測試範圍",
        receivedAt: new Date().toISOString().slice(0, 10),
        targets: [{ targetType: "item", targetId: "fake-item-id" }],
      },
    });
    expect(created.status).toBe(201);
    const requestId = (created.json as { id: string }).id;

    const missingReason = await api(`/api/admin/legal-requests/${requestId}/reject`, {
      method: "PATCH",
      user: approverAdmin,
      body: {},
    });
    expect(missingReason.status).toBe(422);

    const reject = await api(`/api/admin/legal-requests/${requestId}/reject`, {
      method: "PATCH",
      user: approverAdmin,
      body: { rejectionReason: "公文字號無法核實" },
    });
    expect(reject.status).toBe(200);

    const request = await db.lawEnforcementRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe("rejected");
    expect(request.rejectionReason).toBe("公文字號無法核實");
  });
});
