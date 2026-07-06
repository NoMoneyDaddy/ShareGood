import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { createItemRemoval } from "../support/appeals";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §7 第 7 項「後台最小集」`/admin`：待辦總覽（未處理檢舉/申訴/回報數）、
// 物品管理（搜尋＋下架）、使用者管理（搜尋＋限制）、audit log 查詢。
//
// 對應實作：src/app/admin/page.tsx（總覽）、src/app/admin/reports/*（檢舉列表＋處理，
// 呼叫既有 GET/PATCH /api/reports[/:id]）、src/app/admin/appeals/*（申訴複審，僅 admin，
// 呼叫既有 GET/PATCH /api/appeals[/:id]）、src/app/admin/items/*（物品搜尋＋強制下架，
// 呼叫既有 PATCH /api/items/[id]/force-remove）、src/app/admin/users/*（使用者搜尋＋
// 限制管理，呼叫既有 POST/DELETE /api/admin/user-restrictions[...]）、
// src/app/admin/audit-logs/page.tsx（稽核紀錄查詢）。
describe("M2 Admin 後台最小集", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function moderator(label: string): Promise<TestUser> {
    const u = await user(label);
    await db.userRole.create({ data: { userId: u.id, role: "moderator" } });
    return u;
  }

  async function admin(label: string): Promise<TestUser> {
    const u = await user(label);
    await db.userRole.create({ data: { userId: u.id, role: "admin" } });
    return u;
  }

  afterAll(async () => {
    // 申訴會擋 StorageObject 的 onDelete: Restrict，跟 appeals.test.ts 同樣的理由，
    // 先手動清掉這次測試建立的 Appeal，再走既有的 cleanupTestData。
    await db.appeal.deleteMany({ where: { userId: { in: userIds } } });
    await cleanupTestData(userIds);
  });

  it("未登入或非 moderator/admin 造訪任何 /admin/* 頁面 → 一般使用者 404，未登入導回首頁", async () => {
    const plainUser = await user("admin-page-plain");

    const paths = [
      "/admin",
      "/admin/reports",
      "/admin/appeals",
      "/admin/items",
      "/admin/users",
      "/admin/audit-logs",
    ];

    for (const path of paths) {
      const anon = await api(path);
      expect(anon.status).toBe(200); // redirect("/") 落地到公開首頁

      const denied = await api(path, { user: plainUser });
      expect(denied.status).toBe(404);
    }
  });

  it("moderator 可以看到 /admin 及大部分子頁；/admin/appeals 僅 admin 可見（master-plan §7 第 6 項「admin 複審」）", async () => {
    const mod = await moderator("admin-page-mod");
    const adminUser = await admin("admin-page-admin");

    const dashboard = await api("/admin", { user: mod });
    expect(dashboard.status).toBe(200);
    expect(String(dashboard.json)).toContain("後台管理");

    const reportsPage = await api("/admin/reports", { user: mod });
    expect(reportsPage.status).toBe(200);
    expect(String(reportsPage.json)).toContain("檢舉處理");

    const itemsPage = await api("/admin/items", { user: mod });
    expect(itemsPage.status).toBe(200);
    expect(String(itemsPage.json)).toContain("物品管理");

    const usersPage = await api("/admin/users", { user: mod });
    expect(usersPage.status).toBe(200);
    expect(String(usersPage.json)).toContain("使用者管理");

    const auditLogsPage = await api("/admin/audit-logs", { user: mod });
    expect(auditLogsPage.status).toBe(200);
    expect(String(auditLogsPage.json)).toContain("稽核紀錄");

    // moderator 進不去申訴複審頁：GET /api/appeals?scope=all 本來就只給 admin 用，
    // 讓 moderator 進來只會看到一個誤導性的空清單，故意收窄成 admin-only。
    const appealsAsMod = await api("/admin/appeals", { user: mod });
    expect(appealsAsMod.status).toBe(404);

    const appealsAsAdmin = await api("/admin/appeals", { user: adminUser });
    expect(appealsAsAdmin.status).toBe(200);
    expect(String(appealsAsAdmin.json)).toContain("申訴複審");
  });

  it("待辦總覽三個數字：新增一筆待處理檢舉/回報/申訴後，/admin 顯示的數字各自 +1", async () => {
    const mod = await moderator("admin-dashboard-mod");
    const reporter = await user("admin-dashboard-reporter");
    const ticketOwner = await user("admin-dashboard-ticket-owner");
    const appealOwner = await user("admin-dashboard-appeal-owner");

    const OPEN_REPORT_STATUSES = ["submitted", "triaged", "in_progress"] as const;
    const OPEN_SUPPORT_TICKET_STATUSES = ["open", "in_progress"] as const;

    const [beforeReports, beforeTickets, beforeAppeals] = await Promise.all([
      db.report.count({ where: { status: { in: [...OPEN_REPORT_STATUSES] } } }),
      db.supportTicket.count({ where: { status: { in: [...OPEN_SUPPORT_TICKET_STATUSES] } } }),
      db.appeal.count({ where: { status: "pending" } }),
    ]);

    const itemId = await createPublishedItem(reporter);
    const reportRes = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId, category: "other", description: "後台總覽測試用檢舉" },
    });
    expect(reportRes.status).toBe(201);

    const ticketRes = await api("/api/support-tickets", {
      method: "POST",
      user: ticketOwner,
      body: { category: "bug", subject: "後台總覽測試回報", description: "後台總覽測試用回報內容" },
    });
    expect(ticketRes.status).toBe(201);

    const appealItemId = await createPublishedItem(appealOwner);
    const removal = await createItemRemoval(appealItemId);
    const appealRes = await api("/api/appeals", {
      method: "POST",
      user: appealOwner,
      body: { itemRemovalId: removal.id, reason: "後台總覽測試用申訴" },
    });
    expect(appealRes.status).toBe(201);

    const dashboard = await api("/admin", { user: mod });
    expect(dashboard.status).toBe(200);
    const html = String(dashboard.json);

    const [afterReports, afterTickets, afterAppeals] = await Promise.all([
      db.report.count({ where: { status: { in: [...OPEN_REPORT_STATUSES] } } }),
      db.supportTicket.count({ where: { status: { in: [...OPEN_SUPPORT_TICKET_STATUSES] } } }),
      db.appeal.count({ where: { status: "pending" } }),
    ]);
    expect(afterReports).toBe(beforeReports + 1);
    expect(afterTickets).toBe(beforeTickets + 1);
    expect(afterAppeals).toBe(beforeAppeals + 1);

    // 頁面顯示的數字要跟資料庫當下算出來的數字一致（不是重寫一份查詢邏輯去比對，
    // 而是驗證同一個時間點頁面渲染的結果沒有算錯）。
    expect(html).toContain(`>${afterReports}<`);
    expect(html).toContain(`>${afterTickets}<`);
    expect(html).toContain(`>${afterAppeals}<`);
  });

  it("物品管理：搜尋得到物品；強制下架後該物品的下架表單消失、稽核紀錄查得到", async () => {
    const mod = await moderator("admin-items-mod");
    const owner = await user("admin-items-owner");
    const uniqueTitle = `後台物品搜尋測試-${randomUUID().slice(0, 8)}`;
    const itemId = await createPublishedItem(owner, { title: uniqueTitle });

    const searchRes = await api(`/admin/items?q=${encodeURIComponent(uniqueTitle)}`, {
      user: mod,
    });
    expect(searchRes.status).toBe(200);
    const beforeHtml = String(searchRes.json);
    expect(beforeHtml).toContain(uniqueTitle);
    // 用精確的文字節點邊界比對按鈕本身，避免跟下面「已被強制下架」狀態徽章的子字串混淆。
    expect(beforeHtml).toContain(">強制下架<");

    const removeRes = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: { reason: "後台物品管理測試下架" },
    });
    expect(removeRes.status).toBe(200);

    const afterSearch = await api(`/admin/items?q=${encodeURIComponent(uniqueTitle)}`, {
      user: mod,
    });
    expect(afterSearch.status).toBe(200);
    const afterHtml = String(afterSearch.json);
    expect(afterHtml).toContain(uniqueTitle);
    expect(afterHtml).toContain("已被強制下架"); // 狀態徽章文字
    expect(afterHtml).not.toContain(">強制下架<"); // 終態物品不再顯示下架表單的觸發按鈕

    const auditPage = await api(`/admin/audit-logs?targetType=item&targetId=${itemId}`, {
      user: mod,
    });
    expect(auditPage.status).toBe(200);
    expect(String(auditPage.json)).toContain("item.force_remove");
  });

  it("使用者管理：搜尋得到使用者；建立限制後看得到，解除後消失", async () => {
    const mod = await moderator("admin-users-mod");
    const target = await user("admin-users-target");
    const uniqueReason = `後台限制測試原因-${randomUUID().slice(0, 8)}`;

    const searchRes = await api(`/admin/users?q=${encodeURIComponent(target.nickname)}`, {
      user: mod,
    });
    expect(searchRes.status).toBe(200);
    expect(String(searchRes.json)).toContain(target.email);

    const createRes = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: uniqueReason },
    });
    expect(createRes.status).toBe(201);
    const restrictionId = (createRes.json as { id: string }).id;

    const afterCreate = await api(`/admin/users?q=${encodeURIComponent(target.nickname)}`, {
      user: mod,
    });
    expect(String(afterCreate.json)).toContain(uniqueReason);

    const liftRes = await api(`/api/admin/user-restrictions/${restrictionId}`, {
      method: "DELETE",
      user: mod,
    });
    expect(liftRes.status).toBe(200);

    const afterLift = await api(`/admin/users?q=${encodeURIComponent(target.nickname)}`, {
      user: mod,
    });
    expect(String(afterLift.json)).not.toContain(uniqueReason);
  });

  it("site-header：moderator/admin 登入後看得到「後台管理」入口，一般使用者與訪客看不到", async () => {
    const mod = await moderator("admin-nav-mod");
    const plainUser = await user("admin-nav-plain");

    const anon = await api("/");
    expect(anon.status).toBe(200);
    expect(String(anon.json)).not.toContain("後台管理");

    const plain = await api("/", { user: plainUser });
    expect(plain.status).toBe(200);
    expect(String(plain.json)).not.toContain("後台管理");

    const modHome = await api("/", { user: mod });
    expect(modHome.status).toBe(200);
    expect(String(modHome.json)).toContain("後台管理");
  });
});
