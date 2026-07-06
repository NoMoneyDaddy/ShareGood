import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createSupportAttachment, grantRole } from "../support/support-tickets";

// master-plan §7「使用者回報（support tickets）」與本次任務驗收清單：
// 建立／查詢／留言跟進／狀態轉換／權限邊界（非本人非 moderator 讀取 → 404）都要有測試證據。
describe("M2 使用者回報（support tickets）", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("未登入建立回報 → 401", async () => {
    const res = await api("/api/support-tickets", {
      method: "POST",
      body: { category: "bug", subject: "有東西壞了", description: "詳細描述" },
    });
    expect(res.status).toBe(401);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("建立回報成功（含附件），並可在自己的列表與詳情看到", async () => {
    const reporter = await user("ticket-create");
    const attachmentId = await createSupportAttachment(reporter.id);

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: {
        category: "bug",
        subject: "上傳圖片失敗",
        description: "上傳 HEIC 圖片時一直轉圈圈",
        attachmentObjectIds: [attachmentId],
      },
    });
    expect(createRes.status).toBe(201);
    const created = createRes.json as { id: string; status: string };
    expect(created.status).toBe("open");

    // 附件應該被標記為 linked。
    const attachment = await db.storageObject.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(attachment.status).toBe("linked");

    const listRes = await api("/api/support-tickets", { user: reporter });
    expect(listRes.status).toBe(200);
    const list = listRes.json as { tickets: { id: string }[] };
    expect(list.tickets.some((t) => t.id === created.id)).toBe(true);

    const detailRes = await api(`/api/support-tickets/${created.id}`, { user: reporter });
    expect(detailRes.status).toBe(200);
    const detail = detailRes.json as {
      subject: string;
      attachments: { id: string }[];
      events: unknown[];
    };
    expect(detail.subject).toBe("上傳圖片失敗");
    expect(detail.attachments).toHaveLength(1);
    expect(detail.events).toHaveLength(0);
  });

  it("category 不合法 / 欄位長度不合法 → 422", async () => {
    const reporter = await user("ticket-validate");

    const badCategory = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "not-a-category", subject: "abc", description: "abc" },
    });
    expect(badCategory.status).toBe(422);

    const shortSubject = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "a", description: "abc" },
    });
    expect(shortSubject.status).toBe(422);
  });

  it("附件超過 3 張 → 422；用他人上傳的附件 → 403；重複使用同一附件 → 422", async () => {
    const reporter = await user("ticket-attach-limit");
    const stranger = await user("ticket-attach-stranger");

    const fourAttachments = await Promise.all(
      Array.from({ length: 4 }, () => createSupportAttachment(reporter.id)),
    );
    const tooMany = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: {
        category: "other",
        subject: "附件太多",
        description: "測試附件上限",
        attachmentObjectIds: fourAttachments,
      },
    });
    expect(tooMany.status).toBe(422);

    const strangerAttachment = await createSupportAttachment(stranger.id);
    const useOthers = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: {
        category: "other",
        subject: "用別人的附件",
        description: "測試附件擁有者檢查",
        attachmentObjectIds: [strangerAttachment],
      },
    });
    expect(useOthers.status).toBe(403);

    const reused = await createSupportAttachment(reporter.id);
    const first = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: {
        category: "other",
        subject: "第一次使用附件",
        description: "測試附件重複使用",
        attachmentObjectIds: [reused],
      },
    });
    expect(first.status).toBe(201);

    const second = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: {
        category: "other",
        subject: "第二次想用同一個附件",
        description: "應該被擋下來",
        attachmentObjectIds: [reused],
      },
    });
    expect(second.status).toBe(422);
  });

  it("非本人、非 moderator/admin 讀取他人的 ticket → 404", async () => {
    const reporter = await user("ticket-privacy-owner");
    const stranger = await user("ticket-privacy-stranger");
    const moderator = await user("ticket-privacy-mod");
    await grantRole(moderator.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "account", subject: "帳號無法登入", description: "詳細描述帳號問題" },
    });
    expect(createRes.status).toBe(201);
    const ticketId = (createRes.json as { id: string }).id;

    const strangerRead = await api(`/api/support-tickets/${ticketId}`, { user: stranger });
    expect(strangerRead.status).toBe(404);
    expect((strangerRead.json as { error: { code: string } }).error.code).toBe("NOT_FOUND");

    const modRead = await api(`/api/support-tickets/${ticketId}`, { user: moderator });
    expect(modRead.status).toBe(200);

    // 陌生人也不能對別人的 ticket 留言跟進：一樣回 404。
    const strangerEvent = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: stranger,
      body: { message: "我路過留言" },
    });
    expect(strangerEvent.status).toBe(404);
  });

  it("本人可以純留言跟進；一般使用者無法轉換狀態（403）", async () => {
    const reporter = await user("ticket-comment-owner");
    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "留言跟進測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    const commentRes = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: reporter,
      body: { message: "請問處理進度如何？" },
    });
    expect(commentRes.status).toBe(201);
    const comment = commentRes.json as {
      fromStatus: string | null;
      toStatus: string | null;
      message: string;
    };
    expect(comment.fromStatus).toBeNull();
    expect(comment.toStatus).toBeNull();
    expect(comment.message).toBe("請問處理進度如何？");

    const escalate = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: reporter,
      body: { toStatus: "in_progress" },
    });
    expect(escalate.status).toBe(403);

    const ticketAfter = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticketAfter.status).toBe("open"); // 狀態沒有被非法轉換
  });

  it("moderator/admin 可以留言＋轉換狀態；非法的狀態轉換 → 409", async () => {
    const reporter = await user("ticket-status-owner");
    const moderator = await user("ticket-status-mod");
    await grantRole(moderator.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "狀態轉換測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    const toInProgress = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { message: "已收到，開始處理", toStatus: "in_progress" },
    });
    expect(toInProgress.status).toBe(201);
    const event1 = toInProgress.json as { fromStatus: string; toStatus: string };
    expect(event1.fromStatus).toBe("open");
    expect(event1.toStatus).toBe("in_progress");

    let ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("in_progress");

    // 非法轉換：in_progress 不能直接跳回 open。
    const invalid = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { toStatus: "open" },
    });
    expect(invalid.status).toBe(409);

    const toResolved = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { toStatus: "resolved" },
    });
    expect(toResolved.status).toBe(201);

    ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.status).toBe("resolved");

    // closed 是終態，之後不能再轉換。
    const toClosed = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { toStatus: "closed" },
    });
    expect(toClosed.status).toBe(201);

    const afterClosed = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { toStatus: "in_progress" },
    });
    expect(afterClosed.status).toBe(409);

    // 但結案後還是可以留純留言（不轉狀態）。
    const followUpComment = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { message: "已結案，如仍有問題請開新回報" },
    });
    expect(followUpComment.status).toBe(201);

    const detail = await api(`/api/support-tickets/${ticketId}`, { user: reporter });
    const events = (detail.json as { events: { toStatus: string | null }[] }).events;
    expect(events).toHaveLength(4);
  });

  it("兩個 moderator 同時把同一張 ticket 轉換狀態，只有一個成功", async () => {
    const reporter = await user("ticket-race-owner");
    const modA = await user("ticket-race-mod-a");
    const modB = await user("ticket-race-mod-b");
    await grantRole(modA.id, "moderator");
    await grantRole(modB.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "併發狀態轉換測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    const [resA, resB] = await Promise.all([
      api(`/api/support-tickets/${ticketId}/events`, {
        method: "POST",
        user: modA,
        body: { toStatus: "in_progress" },
      }),
      api(`/api/support-tickets/${ticketId}/events`, {
        method: "POST",
        user: modB,
        body: { toStatus: "in_progress" },
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // 一個成功轉換（201），另一個因為狀態已經被改過而 409（見 route 內 STALE_STATUS）。
    expect(statuses).toEqual([201, 409]);

    const events = await db.supportTicketEvent.findMany({ where: { ticketId } });
    expect(events.filter((e) => e.toStatus === "in_progress")).toHaveLength(1);
  });

  it("狀態轉換會寫一筆 audit_logs（管理操作稽核）", async () => {
    const reporter = await user("ticket-audit-owner");
    const moderator = await user("ticket-audit-mod");
    await grantRole(moderator.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "稽核紀錄測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    const before = await db.auditLog.count({
      where: { targetType: "support_ticket", targetId: ticketId },
    });
    const res = await api(`/api/support-tickets/${ticketId}/events`, {
      method: "POST",
      user: moderator,
      body: { toStatus: "in_progress" },
    });
    expect(res.status).toBe(201);

    const logs = await db.auditLog.findMany({
      where: { targetType: "support_ticket", targetId: ticketId },
    });
    expect(logs.length).toBe(before + 1);
    expect(logs.some((l) => l.action === "support_ticket.status_change")).toBe(true);
  });

  it("moderator 可以認領（PATCH assign）／放棄認領；一般使用者不能指派", async () => {
    const reporter = await user("ticket-assign-owner");
    const modA = await user("ticket-assign-mod-a");
    const modB = await user("ticket-assign-mod-b");
    await grantRole(modA.id, "moderator");
    await grantRole(modB.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "bug", subject: "指派測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    // 一般使用者（reporter 本人）不能指派。
    const deniedRes = await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: reporter,
      body: { assigneeId: reporter.id },
    });
    expect(deniedRes.status).toBe(403);

    // moderator A 認領給自己。
    const assignRes = await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: modA,
      body: { assigneeId: modA.id },
    });
    expect(assignRes.status).toBe(200);
    expect((assignRes.json as { assignedTo: string }).assignedTo).toBe(modA.id);

    // 指派給一個不是 moderator/admin 的一般使用者 → 422。
    const invalidAssignee = await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: modB,
      body: { assigneeId: reporter.id },
    });
    expect(invalidAssignee.status).toBe(422);

    // moderator B 改指派給自己（覆蓋 A 的認領）。
    const reassignRes = await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: modB,
      body: { assigneeId: modB.id },
    });
    expect(reassignRes.status).toBe(200);
    expect((reassignRes.json as { assignedTo: string }).assignedTo).toBe(modB.id);

    // 取消指派。
    const unassignRes = await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: modB,
      body: { assigneeId: null },
    });
    expect(unassignRes.status).toBe(200);
    expect((unassignRes.json as { assignedTo: string | null }).assignedTo).toBeNull();

    // 每次指派變更都寫 audit log 與時間軸事件。
    const logs = await db.auditLog.count({
      where: { targetType: "support_ticket", targetId: ticketId, action: "support_ticket.assign" },
    });
    expect(logs).toBe(3);
    const detail = await api(`/api/support-tickets/${ticketId}`, { user: reporter });
    const events = (detail.json as { events: { message: string | null }[] }).events;
    expect(events.filter((e) => e.message?.includes("指派"))).toHaveLength(3);
  });

  it("GET /api/admin/support-tickets：一般使用者 403；moderator 看得到全部並可依 status/assigned 篩選", async () => {
    const reporter = await user("ticket-adminlist-owner");
    const moderator = await user("ticket-adminlist-mod");
    await grantRole(moderator.id, "moderator");

    const createRes = await api("/api/support-tickets", {
      method: "POST",
      user: reporter,
      body: { category: "account", subject: "後台列表測試", description: "詳細描述" },
    });
    const ticketId = (createRes.json as { id: string }).id;

    const deniedRes = await api("/api/admin/support-tickets", { user: reporter });
    expect(deniedRes.status).toBe(403);

    const anonRes = await api("/api/admin/support-tickets");
    expect(anonRes.status).toBe(401);

    const allRes = await api("/api/admin/support-tickets?status=open", { user: moderator });
    expect(allRes.status).toBe(200);
    const all = allRes.json as { tickets: { id: string }[] };
    expect(all.tickets.some((t) => t.id === ticketId)).toBe(true);

    const unassignedRes = await api("/api/admin/support-tickets?assigned=unassigned", {
      user: moderator,
    });
    expect(
      (unassignedRes.json as { tickets: { id: string }[] }).tickets.some((t) => t.id === ticketId),
    ).toBe(true);

    await api(`/api/support-tickets/${ticketId}`, {
      method: "PATCH",
      user: moderator,
      body: { assigneeId: moderator.id },
    });
    const assignedToMeRes = await api("/api/admin/support-tickets?assigned=me", {
      user: moderator,
    });
    expect(
      (assignedToMeRes.json as { tickets: { id: string }[] }).tickets.some(
        (t) => t.id === ticketId,
      ),
    ).toBe(true);

    const invalidStatus = await api("/api/admin/support-tickets?status=not-a-status", {
      user: moderator,
    });
    expect(invalidStatus.status).toBe(422);
  });

  it("前台頁面：/support 需登入；/admin/support-tickets 僅 moderator/admin 看得到", async () => {
    const reporter = await user("ticket-page-owner");
    const moderator = await user("ticket-page-mod");
    await grantRole(moderator.id, "moderator");

    // 未登入造訪 /support 會被導回首頁（redirect），最終落地頁不會有回報表單的送出按鈕
    // ——不能用「問題回報」當關鍵字，因為 site-footer 在任何頁面都有一個同名連結。
    const anonSupport = await api("/support");
    expect(anonSupport.status).toBe(200);
    expect(String(anonSupport.json)).not.toContain("送出回報");

    const loggedInSupport = await api("/support", { user: reporter });
    expect(loggedInSupport.status).toBe(200);
    expect(String(loggedInSupport.json)).toContain("送出回報");

    // 一般使用者造訪後台列表頁 → 404（notFound()，不透露頁面存在）。
    const deniedAdminPage = await api("/admin/support-tickets", { user: reporter });
    expect(deniedAdminPage.status).toBe(404);

    const modAdminPage = await api("/admin/support-tickets", { user: moderator });
    expect(modAdminPage.status).toBe(200);
    expect(String(modAdminPage.json)).toContain("使用者回報處理");
  });
});
