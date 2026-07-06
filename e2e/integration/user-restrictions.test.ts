import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

// master-plan §7「功能限制」驗收清單相關：
// 「被禁言者留言 → 403 且訊息明確；被封鎖者所有 mutation 皆 403。」
// 「moderator 不能改 admin 的權限（RBAC 邊界測試）。」
//
// 對應實作：src/lib/restrictions.ts（checkUserRestriction／checkFullBlock）、
// src/app/api/admin/user-restrictions/route.ts（建立限制）、
// src/app/api/admin/user-restrictions/[id]/route.ts（提前解除限制）、
// 以及疊加進 items/claims/conversations-messages 等既有 mutation API 的檢查點。
//
// 這支測試特別驗證「疊加檢查沒有破壞既有留言/直贈/上架的正常流程」：每個限制情境都先跑一次
// 「沒有限制時應該成功」的對照組（多半由既有的 permissions/concurrency 測試涵蓋，這裡只在
// 必要處重複最小對照），再驗證「有對應限制時應該被擋下」。
describe("M2 功能限制（禁上架/禁留言/禁私訊/封鎖）", () => {
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
    await cleanupTestData(userIds);
  });

  it("被限制上架（no_posting）的使用者呼叫 POST /api/items → 403 且訊息明確", async () => {
    const target = await user("restrict-posting");
    const mod = await moderator("restrict-posting-mod");

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: "測試禁止上架" },
    });
    expect(create.status).toBe(201);

    const { cityId, categoryId } = await pickCityAndCategory();
    const res = await api("/api/items", {
      method: "POST",
      user: target,
      body: {
        title: "被禁止上架的物品",
        description: "這篇不應該建立成功",
        categoryId,
        cityId,
        images: [],
      },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string; message: string } }).error.code).toBe("FORBIDDEN");
    expect((res.json as { error: { message: string } }).error.message).toContain("上架");
  });

  it("沒有限制的使用者仍可正常上架（疊加檢查不影響既有流程）", async () => {
    const owner = await user("restrict-posting-control");
    const itemId = await createPublishedItem(owner);
    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");
  });

  it("被限制留言（no_claiming）的使用者呼叫 POST /api/items/[id]/claims → 403", async () => {
    const owner = await user("restrict-claiming-owner");
    const target = await user("restrict-claiming-target");
    const mod = await moderator("restrict-claiming-mod");
    const itemId = await createPublishedItem(owner);

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_claiming", reason: "測試禁止留言" },
    });
    expect(create.status).toBe(201);

    const res = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: target,
      body: { message: "我想要這個" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect((res.json as { error: { message: string } }).error.message).toContain("留言");

    // 沒有留言紀錄被誤建立。
    const claim = await db.claimComment.findFirst({ where: { itemId, userId: target.id } });
    expect(claim).toBeNull();
  });

  it("沒有限制的使用者仍可正常留言認領（疊加檢查不影響既有流程）", async () => {
    const owner = await user("restrict-claiming-control-owner");
    const claimer = await user("restrict-claiming-control-claimer");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(res.status).toBe(201);
    expect((res.json as { status: string }).status).toBe("accepted");
  });

  it("被限制私訊（no_messaging）的使用者呼叫 POST /api/conversations/[id]/messages → 403", async () => {
    const owner = await user("restrict-messaging-owner");
    const claimer = await user("restrict-messaging-claimer");
    const mod = await moderator("restrict-messaging-mod");
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

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: claimer.id, type: "no_messaging", reason: "測試禁止私訊" },
    });
    expect(create.status).toBe(201);

    const res = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: claimer,
      body: { body: "你好，我想約時間交接" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect((res.json as { error: { message: string } }).error.message).toContain("私訊");

    // 物主本人（未被限制）仍可正常發訊息，確認疊加檢查只擋到被限制的那個使用者。
    const ownerRes = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: owner,
      body: { body: "你好，方便約時間嗎？" },
    });
    expect(ownerRes.status).toBe(201);
  });

  it("被全站封鎖（full_block）的使用者所有 mutation 皆 403", async () => {
    const target = await user("restrict-fullblock");
    const mod = await moderator("restrict-fullblock-mod");

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "full_block", reason: "測試全站封鎖" },
    });
    expect(create.status).toBe(201);

    const { cityId, categoryId } = await pickCityAndCategory();
    const postItem = await api("/api/items", {
      method: "POST",
      user: target,
      body: { title: "封鎖使用者上架", description: "不應該成功", categoryId, cityId, images: [] },
    });
    expect(postItem.status).toBe(403);

    const updateProfile = await api("/api/profile", {
      method: "POST",
      user: target,
      body: { nickname: "改名測試" },
    });
    expect(updateProfile.status).toBe(403);
    expect((updateProfile.json as { error: { message: string } }).error.message).toContain("停權");

    // 讀取（GET）不受影響，封鎖是「唯讀」而不是完全無法使用帳號登入。
    const notifications = await api("/api/notifications", { user: target });
    expect(notifications.status).toBe(200);
  });

  it("已過期的限制不擋，已被提前解除的限制也不擋", async () => {
    const target = await user("restrict-expired");
    const mod = await moderator("restrict-expired-mod");

    // 直接寫入一筆已過期的 no_posting 限制（模擬 admin 之前設過期限制、現在已經過期）。
    await db.userRestriction.create({
      data: {
        userId: target.id,
        type: "no_posting",
        reason: "已過期的舊限制",
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        createdBy: mod.id,
      },
    });

    const { cityId, categoryId } = await pickCityAndCategory();
    const res = await api("/api/items", {
      method: "POST",
      user: target,
      body: {
        title: "過期限制不應該擋",
        description: "限制已過期，應該可以成功建立",
        categoryId,
        cityId,
        images: [],
      },
    });
    // 沒帶圖片會被 422 擋（驗證邏輯本身），但重點是不是 403——確認過期限制沒有生效。
    expect(res.status).not.toBe(403);
  });

  it("admin 提前解除限制後，使用者恢復正常", async () => {
    const target = await user("restrict-lift");
    const mod = await moderator("restrict-lift-mod");

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: "測試解除限制" },
    });
    expect(create.status).toBe(201);
    const restrictionId = (create.json as { id: string }).id;

    const { cityId, categoryId } = await pickCityAndCategory();
    const blocked = await api("/api/items", {
      method: "POST",
      user: target,
      body: { title: "被限制中", description: "應該被擋", categoryId, cityId, images: [] },
    });
    expect(blocked.status).toBe(403);

    const lift = await api(`/api/admin/user-restrictions/${restrictionId}`, {
      method: "DELETE",
      user: mod,
    });
    expect(lift.status).toBe(200);

    const afterLift = await api("/api/items", {
      method: "POST",
      user: target,
      body: {
        title: "解除後",
        description: "限制已解除，不應該再被 403",
        categoryId,
        cityId,
        images: [],
      },
    });
    expect(afterLift.status).not.toBe(403);

    // 重複解除同一筆 → 409（idempotent 保護，不是靜默成功）。
    const liftAgain = await api(`/api/admin/user-restrictions/${restrictionId}`, {
      method: "DELETE",
      user: mod,
    });
    expect(liftAgain.status).toBe(409);
  });

  it("同一使用者同類型不能重複建立生效中的限制 → 409", async () => {
    const target = await user("restrict-duplicate");
    const mod = await moderator("restrict-duplicate-mod");

    const first = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: "第一筆" },
    });
    expect(first.status).toBe(201);

    const second = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: "重複的第二筆" },
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("CONFLICT");
  });

  it("使用者同時有較舊的 full_block 跟較新的 no_posting 時，優先回報停權而非限制上架", async () => {
    const target = await user("restrict-priority");
    const mod = await moderator("restrict-priority-mod");

    // 先建立較舊的 full_block。
    await db.userRestriction.create({
      data: {
        userId: target.id,
        type: "full_block",
        reason: "較舊的停權",
        createdBy: mod.id,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    // 再建立較新的 no_posting（模擬同時存在兩筆限制、其中一筆較新）。
    await db.userRestriction.create({
      data: {
        userId: target.id,
        type: "no_posting",
        reason: "較新的禁止上架",
        createdBy: mod.id,
      },
    });

    const { cityId, categoryId } = await pickCityAndCategory();
    const res = await api("/api/items", {
      method: "POST",
      user: target,
      body: { title: "應該顯示停權", description: "不是限制上架", categoryId, cityId, images: [] },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { message: string } }).error.message).toContain("停權");
  });

  it("被全站封鎖（full_block）的管理員自己不能建立或解除限制", async () => {
    const target = await user("restrict-blocked-mod-target");
    const mod = await moderator("restrict-blocked-mod");

    // 先讓另一個 moderator/admin 把這個 moderator 自己也標記為 full_block
    // （模擬角色還沒被立刻停用、但已經被停權的情境）。
    const otherMod = await moderator("restrict-blocked-mod-other");
    const blockMod = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: otherMod,
      body: { userId: mod.id, type: "full_block", reason: "測試停權後的管理員自己" },
    });
    expect(blockMod.status).toBe(201);

    const create = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: target.id, type: "no_posting", reason: "被停權的管理員嘗試建立限制" },
    });
    expect(create.status).toBe(403);
    expect((create.json as { error: { message: string } }).error.message).toContain("停權");

    // 用 otherMod 先幫 target 建一筆限制，再讓被停權的 mod 嘗試解除它。
    const created = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: otherMod,
      body: { userId: target.id, type: "no_posting", reason: "給被停權的管理員嘗試解除用" },
    });
    expect(created.status).toBe(201);
    const restrictionId = (created.json as { id: string }).id;

    const lift = await api(`/api/admin/user-restrictions/${restrictionId}`, {
      method: "DELETE",
      user: mod,
    });
    expect(lift.status).toBe(403);
    expect((lift.json as { error: { message: string } }).error.message).toContain("停權");
  });

  it("moderator 不能限制 admin 帳號（RBAC 邊界）", async () => {
    const targetAdmin = await admin("restrict-rbac-admin");
    const mod = await moderator("restrict-rbac-mod");

    const res = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: mod,
      body: { userId: targetAdmin.id, type: "no_posting", reason: "moderator 想限制 admin" },
    });
    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("一般使用者（非 moderator/admin）呼叫限制 API → 403；未登入 → 401", async () => {
    const target = await user("restrict-authz-target");
    const stranger = await user("restrict-authz-stranger");

    const forbidden = await api("/api/admin/user-restrictions", {
      method: "POST",
      user: stranger,
      body: { userId: target.id, type: "no_posting", reason: "沒有權限" },
    });
    expect(forbidden.status).toBe(403);

    const unauthorized = await api("/api/admin/user-restrictions", {
      method: "POST",
      body: { userId: target.id, type: "no_posting", reason: "沒有登入" },
    });
    expect(unauthorized.status).toBe(401);
  });
});
