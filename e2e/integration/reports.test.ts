import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, grantRole, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createReportEvidenceObject } from "../support/images";
import { createPublishedItem } from "../support/items";

// master-plan §7 檢舉功能驗收：
// 建立（三選一目標／分類／說明／證據）、查詢（自己的 vs moderator 看全部）、
// 權限邊界（非本人看不到別人的檢舉、非 moderator 打 PATCH 回 403）、狀態機轉換。
describe("M2 檢舉（reports）", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("未登入建立檢舉 → 401", async () => {
    const owner = await user("rpt-owner-401");
    const itemId = await createPublishedItem(owner);

    const res = await api("/api/reports", {
      method: "POST",
      body: { itemId, category: "fraud", description: "測試檢舉內容" },
    });

    expect(res.status).toBe(401);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("目標欄位沒有恰好指定一個 → 422", async () => {
    const owner = await user("rpt-owner-target1");
    const reporter = await user("rpt-reporter-target1");
    const itemId = await createPublishedItem(owner);

    const none = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { category: "fraud", description: "測試檢舉內容" },
    });
    expect(none.status).toBe(422);
    expect((none.json as { error: { code: string } }).error.code).toBe("UNPROCESSABLE");

    const both = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId, claimCommentId: "fake-id", category: "fraud", description: "測試檢舉內容" },
    });
    expect(both.status).toBe(422);
  });

  it("檢舉不存在的物品 → 404", async () => {
    const reporter = await user("rpt-reporter-404");
    const res = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId: "does-not-exist", category: "fraud", description: "測試檢舉內容" },
    });
    expect(res.status).toBe(404);
    expect((res.json as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("無效分類 / 說明過短 → 422", async () => {
    const owner = await user("rpt-owner-invalid");
    const reporter = await user("rpt-reporter-invalid");
    const itemId = await createPublishedItem(owner);

    const badCategory = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId, category: "not_a_category", description: "測試檢舉內容" },
    });
    expect(badCategory.status).toBe(422);

    const badDescription = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId, category: "fraud", description: "" },
    });
    expect(badDescription.status).toBe(422);
  });

  it("建立成功（含證據圖片），並且能在自己的列表看到", async () => {
    const owner = await user("rpt-owner-create");
    const reporter = await user("rpt-reporter-create");
    const itemId = await createPublishedItem(owner);
    const evidenceId = await createReportEvidenceObject(reporter.id);

    const created = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: {
        itemId,
        category: "prohibited_item",
        description: "這個物品疑似違禁品",
        evidenceObjectIds: [evidenceId],
      },
    });
    expect(created.status).toBe(201);
    const { id: reportId, status } = created.json as { id: string; status: string };
    expect(status).toBe("submitted");

    const evidenceObject = await db.storageObject.findUnique({ where: { id: evidenceId } });
    expect(evidenceObject?.status).toBe("linked");

    const mine = await api("/api/reports", { user: reporter });
    expect(mine.status).toBe(200);
    const mineBody = mine.json as { reports: Array<{ id: string; evidence: unknown[] }> };
    const found = mineBody.reports.find((r) => r.id === reportId);
    expect(found).toBeTruthy();
    expect(found?.evidence).toHaveLength(1);
  });

  it("證據圖片超過 3 張 / 使用他人上傳的圖片 → 422 / 403", async () => {
    const owner = await user("rpt-owner-evidence");
    const reporter = await user("rpt-reporter-evidence");
    const stranger = await user("rpt-stranger-evidence");
    const itemId = await createPublishedItem(owner);

    const fourIds = await Promise.all(
      Array.from({ length: 4 }, () => createReportEvidenceObject(reporter.id)),
    );
    const tooMany = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: {
        itemId,
        category: "other",
        description: "測試證據數量上限",
        evidenceObjectIds: fourIds,
      },
    });
    expect(tooMany.status).toBe(422);

    const strangerEvidenceId = await createReportEvidenceObject(stranger.id);
    const notMine = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: {
        itemId,
        category: "other",
        description: "測試證據擁有權",
        evidenceObjectIds: [strangerEvidenceId],
      },
    });
    expect(notMine.status).toBe(403);
    expect((notMine.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("留言檢舉（claimComment 對公開留言，任何登入使用者皆可）", async () => {
    const owner = await user("rpt-owner-claim");
    const claimer = await user("rpt-claimer-claim");
    const reporter = await user("rpt-reporter-claim");
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);
    const { id: claimCommentId } = claim.json as { id: string };

    const res = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { claimCommentId, category: "harassment", description: "這則留言有騷擾字眼" },
    });
    expect(res.status).toBe(201);
  });

  it("私訊檢舉：非對話成員 → 404；成員 → 201", async () => {
    const owner = await user("rpt-owner-msg");
    const claimer = await user("rpt-claimer-msg");
    const stranger = await user("rpt-stranger-msg");
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const { conversationId } = ensure.json as { conversationId: string };

    const sent = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: claimer,
      body: { body: "可以下午拿嗎？" },
    });
    expect(sent.status).toBe(201);
    const { id: messageId } = sent.json as { id: string };

    const strangerReport = await api("/api/reports", {
      method: "POST",
      user: stranger,
      body: { messageId, category: "private_payment", description: "疑似私下收費" },
    });
    expect(strangerReport.status).toBe(404);

    const ownerReport = await api("/api/reports", {
      method: "POST",
      user: owner,
      body: { messageId, category: "private_payment", description: "疑似私下收費" },
    });
    expect(ownerReport.status).toBe(201);
  });

  it("非本人看不到別人的檢舉；moderator 才能用 scope=all 看全部", async () => {
    const owner = await user("rpt-owner-scope");
    const reporterA = await user("rpt-reporterA-scope");
    const reporterB = await user("rpt-reporterB-scope");
    const moderator = await user("rpt-moderator-scope");
    await grantRole(moderator.id, "moderator");

    const itemId = await createPublishedItem(owner);

    const reportA = await api("/api/reports", {
      method: "POST",
      user: reporterA,
      body: { itemId, category: "fraud", description: "A 的檢舉" },
    });
    expect(reportA.status).toBe(201);
    const { id: reportAId } = reportA.json as { id: string };

    // reporterB 看不到 reporterA 的檢舉
    const bMine = await api("/api/reports", { user: reporterB });
    expect(bMine.status).toBe(200);
    const bIds = (bMine.json as { reports: Array<{ id: string }> }).reports.map((r) => r.id);
    expect(bIds).not.toContain(reportAId);

    // 一般使用者要求 scope=all → 403
    const forbidden = await api("/api/reports?scope=all", { user: reporterB });
    expect(forbidden.status).toBe(403);
    expect((forbidden.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");

    // moderator 用 scope=all 看得到
    const all = await api("/api/reports?scope=all", { user: moderator });
    expect(all.status).toBe(200);
    const allIds = (all.json as { reports: Array<{ id: string }> }).reports.map((r) => r.id);
    expect(allIds).toContain(reportAId);
  });

  it("PATCH /api/reports/[id]：非 moderator → 403；moderator 依狀態機轉換", async () => {
    const owner = await user("rpt-owner-patch");
    const reporter = await user("rpt-reporter-patch");
    const moderator = await user("rpt-moderator-patch");
    await grantRole(moderator.id, "moderator");
    const itemId = await createPublishedItem(owner);

    const created = await api("/api/reports", {
      method: "POST",
      user: reporter,
      body: { itemId, category: "food_safety", description: "食品疑慮測試" },
    });
    expect(created.status).toBe(201);
    const { id: reportId } = created.json as { id: string };

    // 非 moderator 打 PATCH → 403
    const forbidden = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: reporter,
      body: { status: "triaged" },
    });
    expect(forbidden.status).toBe(403);
    expect((forbidden.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");

    // 未登入 → 401
    const unauth = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      body: { status: "triaged" },
    });
    expect(unauth.status).toBe(401);

    // 非法跳轉：submitted → resolved（跳過 triaged/in_progress）→ 409
    const skip = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "resolved", resolutionNote: "跳過中間狀態" },
    });
    expect(skip.status).toBe(409);
    expect((skip.json as { error: { code: string } }).error.code).toBe("CONFLICT");

    // 合法轉換：submitted → triaged
    const triaged = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "triaged" },
    });
    expect(triaged.status).toBe(200);
    expect((triaged.json as { status: string }).status).toBe("triaged");

    // triaged → in_progress
    const inProgress = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "in_progress" },
    });
    expect(inProgress.status).toBe(200);

    // in_progress → resolved 但沒填 resolutionNote → 422
    const missingNote = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "resolved" },
    });
    expect(missingNote.status).toBe(422);

    // in_progress → resolved（附 resolutionNote）
    const resolved = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "resolved", resolutionNote: "已確認並處理完畢" },
    });
    expect(resolved.status).toBe(200);
    const resolvedBody = resolved.json as {
      status: string;
      resolutionNote: string;
      resolvedAt: string;
      handledBy: string;
    };
    expect(resolvedBody.status).toBe("resolved");
    expect(resolvedBody.resolutionNote).toBe("已確認並處理完畢");
    expect(resolvedBody.resolvedAt).toBeTruthy();
    expect(resolvedBody.handledBy).toBe(moderator.id);

    // resolved → closed
    const closed = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "closed" },
    });
    expect(closed.status).toBe(200);

    // closed 之後不能再轉換
    const afterClosed = await api(`/api/reports/${reportId}`, {
      method: "PATCH",
      user: moderator,
      body: { status: "triaged" },
    });
    expect(afterClosed.status).toBe(409);

    // audit log 有紀錄
    const auditLogs = await db.auditLog.findMany({
      where: { targetType: "report", targetId: reportId, action: "report.status_change" },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(4);
  });
});
