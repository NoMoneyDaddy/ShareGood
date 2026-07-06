import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §7 驗收清單相關：
// 「強制下架：moderator/admin 對物品強制下架（必填原因＋備註），通知物主，寫 audit log」
// 「每個管理操作在 audit_logs 有紀錄（actor、action、target、時間）」
//
// 對應實作：src/app/api/items/[id]/force-remove/route.ts（PATCH）、
// src/app/api/items/[id]/removal/route.ts（GET）。
describe("M2 強制下架", () => {
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

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("moderator 強制下架 published 物品 → 轉態、寫 ItemRemoval/AuditLog、通知物主", async () => {
    const owner = await user("force-owner-ok");
    const mod = await moderator("force-mod-ok");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: { reason: "疑似詐騙", note: "使用者檢舉三次" },
    });
    expect(res.status).toBe(200);
    expect((res.json as { status: string }).status).toBe("removed_by_moderator");
    const removalId = (res.json as { removalId: string }).removalId;

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("removed_by_moderator");

    const statusLog = await db.itemStatusLog.findFirst({
      where: { itemId, toStatus: "removed_by_moderator" },
    });
    expect(statusLog).not.toBeNull();
    expect(statusLog?.fromStatus).toBe("published");
    expect(statusLog?.actorId).toBe(mod.id);

    const removal = await db.itemRemoval.findUniqueOrThrow({ where: { id: removalId } });
    expect(removal.itemId).toBe(itemId);
    expect(removal.moderatorId).toBe(mod.id);
    expect(removal.reason).toBe("疑似詐騙");
    expect(removal.note).toBe("使用者檢舉三次");

    const auditLog = await db.auditLog.findFirst({
      where: { action: "item.force_remove", targetType: "item", targetId: itemId },
    });
    expect(auditLog).not.toBeNull();
    expect(auditLog?.actorId).toBe(mod.id);
    expect(auditLog?.sensitive).toBe(false);

    const notification = await db.notification.findFirst({
      where: { userId: owner.id },
      orderBy: { createdAt: "desc" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.type).toBe("handover_message");
    expect((notification?.payload as { kind?: string }).kind).toBe("item_force_removed");
    expect((notification?.payload as { itemId?: string }).itemId).toBe(itemId);
  });

  it("非 moderator/admin 打這支 API → 403", async () => {
    const owner = await user("force-owner-403");
    const stranger = await user("force-stranger-403");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: stranger,
      body: { reason: "測試" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published"); // 沒有被誤轉態
  });

  it("未登入呼叫 → 401", async () => {
    const owner = await user("force-owner-401");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      body: { reason: "測試" },
    });
    expect(res.status).toBe(401);
  });

  it("缺 reason → 422", async () => {
    const owner = await user("force-owner-422");
    const mod = await moderator("force-mod-422");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: {},
    });
    expect(res.status).toBe(422);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNPROCESSABLE");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");
  });

  it("已終態物品（重複下架）→ 409", async () => {
    const owner = await user("force-owner-409");
    const mod = await moderator("force-mod-409");
    const itemId = await createPublishedItem(owner);

    const first = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: { reason: "第一次下架" },
    });
    expect(first.status).toBe(200);

    const second = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: { reason: "第二次下架" },
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("CONFLICT");

    // 確認沒有因為重複呼叫多寫一筆 ItemRemoval / AuditLog。
    const removals = await db.itemRemoval.findMany({ where: { itemId } });
    expect(removals).toHaveLength(1);
    const auditLogs = await db.auditLog.findMany({
      where: { action: "item.force_remove", targetType: "item", targetId: itemId },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it("GET removal：物主與 moderator 看得到，第三人看不到（404）", async () => {
    const owner = await user("removal-get-owner");
    const mod = await moderator("removal-get-mod");
    const stranger = await user("removal-get-stranger");
    const itemId = await createPublishedItem(owner);

    const removeRes = await api(`/api/items/${itemId}/force-remove`, {
      method: "PATCH",
      user: mod,
      body: { reason: "違禁品" },
    });
    expect(removeRes.status).toBe(200);

    const ownerRead = await api(`/api/items/${itemId}/removal`, { user: owner });
    expect(ownerRead.status).toBe(200);
    expect((ownerRead.json as { reason: string }).reason).toBe("違禁品");

    const modRead = await api(`/api/items/${itemId}/removal`, { user: mod });
    expect(modRead.status).toBe(200);

    const strangerRead = await api(`/api/items/${itemId}/removal`, { user: stranger });
    expect(strangerRead.status).toBe(404);

    const anonRead = await api(`/api/items/${itemId}/removal`);
    expect(anonRead.status).toBe(401);
  });

  it("GET removal：沒被下架過的物品 → 404", async () => {
    const owner = await user("removal-get-none");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/removal`, { user: owner });
    expect(res.status).toBe(404);
  });
});
