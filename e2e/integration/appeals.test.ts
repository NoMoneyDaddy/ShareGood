import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import {
  createAppealAttachment,
  createItemRemoval,
  createUserRestriction,
  grantAdmin,
} from "../support/appeals";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §7 第 6 項：「被下架/被限制者可申訴一次，admin 複審」。
// 對應實作：src/app/api/appeals/route.ts（POST/GET）、src/app/api/appeals/[id]/route.ts
// （GET/PATCH）。ItemRemoval／UserRestriction 目前還沒有建立端點（強制下架／使用者限制
// 是 master-plan §7 第 3、4 項，本次不做），測試直接在 DB 造這兩張表的前置資料
// （見 e2e/support/appeals.ts 的說明）。
describe("申訴（Appeal）", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    // Appeal 的 user-restriction 分支不會被 cleanupTestData 的既有刪除順序（先刪 Item
    // 才刪 StorageObject 再刪 User）覆蓋到——AppealEvidence.storageObject 是
    // onDelete: Restrict，若對應的 Appeal 還沒被刪掉就先刪 StorageObject 會噴錯，
    // 所以這裡先手動刪掉這次測試建立的所有 Appeal（連帶 cascade 掉 AppealEvidence），
    // 再走既有的 cleanupTestData。
    await db.appeal.deleteMany({ where: { userId: { in: userIds } } });
    await cleanupTestData(userIds);
  });

  it("未登入建立申訴 → 401", async () => {
    const res = await api("/api/appeals", {
      method: "POST",
      body: { reason: "測試" },
    });
    expect(res.status).toBe(401);
  });

  it("itemRemovalId 與 userRestrictionId 都沒帶／都帶 → 422", async () => {
    const owner = await user("appeal-both-422");
    const none = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: { reason: "測試理由" },
    });
    expect(none.status).toBe(422);

    const both = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: { reason: "測試理由", itemRemovalId: "a", userRestrictionId: "b" },
    });
    expect(both.status).toBe(422);
  });

  it("對物品下架紀錄建立申訴成功，重複申訴 409，非本人申訴 403", async () => {
    const owner = await user("appeal-item-owner");
    const stranger = await user("appeal-item-stranger");
    const itemId = await createPublishedItem(owner);
    const removal = await createItemRemoval(itemId);

    const attachmentId = await createAppealAttachment(owner.id);

    const res = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: {
        itemRemovalId: removal.id,
        reason: "我的物品沒有違規，這是誤判",
        evidence: [attachmentId],
      },
    });
    expect(res.status).toBe(201);
    const { id: appealId, status } = res.json as { id: string; status: string };
    expect(status).toBe("pending");

    // DB 層面確認：附件已從 pending 轉 linked、掛在這筆申訴上。
    const evidence = await db.appealEvidence.findMany({ where: { appealId } });
    expect(evidence).toHaveLength(1);
    const linkedObject = await db.storageObject.findUniqueOrThrow({
      where: { id: attachmentId },
    });
    expect(linkedObject.status).toBe("linked");

    // 重複申訴同一筆下架紀錄 → 409（unique constraint）。
    const dup = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: { itemRemovalId: removal.id, reason: "再申訴一次" },
    });
    expect(dup.status).toBe(409);

    // 非本人（不是這個物品的物主）申訴同一筆下架紀錄 → 403。
    const strangerRes = await api("/api/appeals", {
      method: "POST",
      user: stranger,
      body: { itemRemovalId: removal.id, reason: "我要幫他申訴" },
    });
    expect(strangerRes.status).toBe(403);

    // GET /api/appeals/[id]：本人可看，陌生人不行。
    const ownerGet = await api(`/api/appeals/${appealId}`, { user: owner });
    expect(ownerGet.status).toBe(200);
    const strangerGet = await api(`/api/appeals/${appealId}`, { user: stranger });
    expect(strangerGet.status).toBe(403);

    // GET /api/appeals：自己的申訴列表看得到這筆。
    const list = await api("/api/appeals", { user: owner });
    expect(list.status).toBe(200);
    const listBody = list.json as { appeals: Array<{ id: string }> };
    expect(listBody.appeals.some((a) => a.id === appealId)).toBe(true);
  });

  it("非 admin 複審 → 403；admin 核准後物品轉回 published、寫入 item_status_logs", async () => {
    const owner = await user("appeal-approve-owner");
    const plainUser = await user("appeal-approve-plain");
    const admin = await user("appeal-approve-admin");
    await grantAdmin(admin.id);

    const itemId = await createPublishedItem(owner);
    const removal = await createItemRemoval(itemId);
    const created = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: { itemRemovalId: removal.id, reason: "誤判，物品沒有問題" },
    });
    expect(created.status).toBe(201);
    const { id: appealId } = created.json as { id: string };

    const forbidden = await api(`/api/appeals/${appealId}`, {
      method: "PATCH",
      user: plainUser,
      body: { status: "approved", reviewNote: "同意" },
    });
    expect(forbidden.status).toBe(403);

    const approve = await api(`/api/appeals/${appealId}`, {
      method: "PATCH",
      user: admin,
      body: { status: "approved", reviewNote: "確認為誤判，予以復原" },
    });
    expect(approve.status).toBe(200);
    expect((approve.json as { status: string }).status).toBe("approved");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const logs = await db.itemStatusLog.findMany({
      where: { itemId, fromStatus: "removed_by_moderator", toStatus: "published" },
    });
    expect(logs).toHaveLength(1);

    const appeal = await db.appeal.findUniqueOrThrow({ where: { id: appealId } });
    expect(appeal.status).toBe("approved");
    expect(appeal.reviewedBy).toBe(admin.id);
    expect(appeal.reviewedAt).not.toBeNull();

    const auditLogs = await db.auditLog.findMany({
      where: { action: "appeal.review", targetId: appealId },
    });
    expect(auditLogs).toHaveLength(1);

    // 已審核過的申訴不能再審一次。
    const again = await api(`/api/appeals/${appealId}`, {
      method: "PATCH",
      user: admin,
      body: { status: "rejected", reviewNote: "重複審核" },
    });
    expect(again.status).toBe(409);
  });

  it("admin 駁回申訴：物品維持下架狀態，不復原", async () => {
    const owner = await user("appeal-reject-owner");
    const admin = await user("appeal-reject-admin");
    await grantAdmin(admin.id);

    const itemId = await createPublishedItem(owner);
    const removal = await createItemRemoval(itemId);
    const created = await api("/api/appeals", {
      method: "POST",
      user: owner,
      body: { itemRemovalId: removal.id, reason: "不服下架決定" },
    });
    expect(created.status).toBe(201);
    const { id: appealId } = created.json as { id: string };

    const reject = await api(`/api/appeals/${appealId}`, {
      method: "PATCH",
      user: admin,
      body: { status: "rejected", reviewNote: "複審後維持原下架決定" },
    });
    expect(reject.status).toBe(200);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("removed_by_moderator");
  });

  it("使用者限制申訴：admin 核准後 UserRestriction 標記為 lifted", async () => {
    const target = await user("appeal-restriction-target");
    const admin = await user("appeal-restriction-admin");
    await grantAdmin(admin.id);

    const restriction = await createUserRestriction(target.id);
    const created = await api("/api/appeals", {
      method: "POST",
      user: target,
      body: { userRestrictionId: restriction.id, reason: "我沒有違規，限制是誤判" },
    });
    expect(created.status).toBe(201);
    const { id: appealId } = created.json as { id: string };

    const approve = await api(`/api/appeals/${appealId}`, {
      method: "PATCH",
      user: admin,
      body: { status: "approved", reviewNote: "確認誤判，解除限制" },
    });
    expect(approve.status).toBe(200);

    const updated = await db.userRestriction.findUniqueOrThrow({ where: { id: restriction.id } });
    expect(updated.liftedAt).not.toBeNull();
    expect(updated.liftedBy).toBe(admin.id);
  });

  it("GET /api/appeals?scope=all：admin 可看全站待審佇列，一般使用者帶 scope=all 只看得到自己的", async () => {
    const ownerA = await user("appeal-queue-owner-a");
    const ownerB = await user("appeal-queue-owner-b");
    const admin = await user("appeal-queue-admin");
    await grantAdmin(admin.id);

    const itemA = await createPublishedItem(ownerA);
    const removalA = await createItemRemoval(itemA);
    const createdA = await api("/api/appeals", {
      method: "POST",
      user: ownerA,
      body: { itemRemovalId: removalA.id, reason: "佇列測試 A" },
    });
    expect(createdA.status).toBe(201);
    const { id: appealAId } = createdA.json as { id: string };

    const itemB = await createPublishedItem(ownerB);
    const removalB = await createItemRemoval(itemB);
    const createdB = await api("/api/appeals", {
      method: "POST",
      user: ownerB,
      body: { itemRemovalId: removalB.id, reason: "佇列測試 B" },
    });
    expect(createdB.status).toBe(201);
    const { id: appealBId } = createdB.json as { id: string };

    // 先把 B 這筆審完，確認 status=pending 篩選能把它濾掉。
    const reviewB = await api(`/api/appeals/${appealBId}`, {
      method: "PATCH",
      user: admin,
      body: { status: "rejected", reviewNote: "佇列測試：先審掉 B" },
    });
    expect(reviewB.status).toBe(200);

    // admin 查全站待審佇列：看得到 A（還是 pending），看不到 B（已經 rejected）。
    const queue = await api("/api/appeals?scope=all&status=pending", { user: admin });
    expect(queue.status).toBe(200);
    const queueBody = queue.json as { appeals: Array<{ id: string; userId: string }> };
    expect(queueBody.appeals.some((a) => a.id === appealAId)).toBe(true);
    expect(queueBody.appeals.some((a) => a.id === appealBId)).toBe(false);
    expect(queueBody.appeals.find((a) => a.id === appealAId)?.userId).toBe(ownerA.id);

    // 一般使用者（ownerA）帶 scope=all 也只看得到自己的申訴，不會被當成佇列請求。
    const notAdminQueue = await api("/api/appeals?scope=all", { user: ownerA });
    expect(notAdminQueue.status).toBe(200);
    const notAdminBody = notAdminQueue.json as { appeals: Array<{ id: string }> };
    expect(notAdminBody.appeals.every((a) => a.id !== appealBId)).toBe(true);
  });
});
