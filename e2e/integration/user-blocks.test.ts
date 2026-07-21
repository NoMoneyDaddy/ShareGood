import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// M12 產品增量（docs/plan/m12-product-growth.md 交付內容 3）：封鎖使用者。
// 對應實作：src/app/api/users/[id]/block/route.ts、src/lib/user-blocks.ts；
// 檢查掛進 src/app/api/items/[id]/claims/route.ts（留言）、
// src/app/api/items/[id]/direct-shares/route.ts（直贈）；規格明定刻意不掛進
// src/app/api/conversations/[id]/messages/route.ts（不影響進行中的交接對話）。
describe("M12 封鎖使用者", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("不能封鎖自己（422）", async () => {
    const u = await user("block-self");
    const res = await api(`/api/users/${u.id}/block`, { method: "POST", user: u });
    expect(res.status).toBe(422);
  });

  it("封鎖不存在的使用者回 404", async () => {
    const u = await user("block-notfound");
    const res = await api("/api/users/does-not-exist/block", { method: "POST", user: u });
    expect(res.status).toBe(404);
  });

  it("封鎖成功、重複封鎖冪等（去重）、解除封鎖也冪等", async () => {
    const a = await user("block-idempotent-a");
    const b = await user("block-idempotent-b");

    const first = await api(`/api/users/${b.id}/block`, { method: "POST", user: a });
    expect(first.status).toBe(200);
    const second = await api(`/api/users/${b.id}/block`, { method: "POST", user: a });
    expect(second.status).toBe(200);
    const rows = await db.userBlock.findMany({ where: { blockerId: a.id, blockedId: b.id } });
    expect(rows).toHaveLength(1);

    const unblock = await api(`/api/users/${b.id}/block`, { method: "DELETE", user: a });
    expect(unblock.status).toBe(200);
    const unblockAgain = await api(`/api/users/${b.id}/block`, { method: "DELETE", user: a });
    expect(unblockAgain.status).toBe(200);
    const rowsAfter = await db.userBlock.findMany({ where: { blockerId: a.id, blockedId: b.id } });
    expect(rowsAfter).toHaveLength(0);
  });

  it("GET /api/me/blocks 只回傳自己封鎖的名單", async () => {
    const a = await user("block-list-a");
    const b = await user("block-list-b");
    const c = await user("block-list-c");
    await api(`/api/users/${b.id}/block`, { method: "POST", user: a });

    const res = await api("/api/me/blocks", { user: a });
    expect(res.status).toBe(200);
    const body = res.json as { blocks: Array<{ blockedId: string }> };
    expect(body.blocks.map((x) => x.blockedId)).toContain(b.id);
    expect(body.blocks.map((x) => x.blockedId)).not.toContain(c.id);
  });

  it("物主封鎖某使用者後，該使用者留言被擋（通用錯誤訊息，不透露被封鎖）", async () => {
    const owner = await user("block-claim-owner");
    const blocked = await user("block-claim-blocked");
    const itemId = await createPublishedItem(owner);

    await api(`/api/users/${blocked.id}/block`, { method: "POST", user: owner });

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: blocked,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(403);
    const message = (claim.json as { error: { message: string } }).error.message;
    // 無感知封鎖：錯誤訊息不能出現「封鎖」字樣，避免被封鎖方推斷出這個事實。
    expect(message).not.toMatch(/封鎖/);

    const claims = await db.claimComment.findMany({ where: { itemId, userId: blocked.id } });
    expect(claims).toHaveLength(0);
  });

  it("反方向也擋：使用者封鎖物主後，該使用者自己留言也被擋（雙向）", async () => {
    const owner = await user("block-claim-reverse-owner");
    const blocker = await user("block-claim-reverse-blocker");
    const itemId = await createPublishedItem(owner);

    await api(`/api/users/${owner.id}/block`, { method: "POST", user: blocker });

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: blocker,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(403);
  });

  it("解除封鎖後恢復正常，可以正常留言並被接受", async () => {
    const owner = await user("block-unblock-owner");
    const target = await user("block-unblock-target");
    const itemId = await createPublishedItem(owner);

    await api(`/api/users/${target.id}/block`, { method: "POST", user: owner });
    const blockedAttempt = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: target,
      body: { message: "我想要這個" },
    });
    expect(blockedAttempt.status).toBe(403);

    await api(`/api/users/${target.id}/block`, { method: "DELETE", user: owner });
    const afterUnblock = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: target,
      body: { message: "我想要這個" },
    });
    expect(afterUnblock.status).toBe(201);
    expect((afterUnblock.json as { status: string }).status).toBe("accepted");
  });

  it("物主封鎖對方後無法對其發起直贈（通用錯誤訊息）", async () => {
    const owner = await user("block-direct-owner");
    const blocked = await user("block-direct-blocked");
    const itemId = await createPublishedItem(owner);

    await api(`/api/users/${blocked.id}/block`, { method: "POST", user: owner });

    const invite = await api(`/api/items/${itemId}/direct-shares`, {
      method: "POST",
      user: owner,
      body: { receiverEmail: blocked.email },
    });
    expect(invite.status).toBe(403);
    const message = (invite.json as { error: { message: string } }).error.message;
    expect(message).not.toMatch(/封鎖/);

    const shares = await db.directShare.findMany({ where: { itemId } });
    expect(shares).toHaveLength(0);
  });

  it("封鎖不影響已經在進行中的交接對話：留言接受成立配對後，任一方封鎖對方仍能繼續私訊", async () => {
    const owner = await user("block-handover-owner");
    const receiver = await user("block-handover-receiver");
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);
    expect((claim.json as { status: string }).status).toBe("accepted");

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const conversationId = (ensure.json as { conversationId: string }).conversationId;

    // 配對成立「之後」才封鎖：規格明定這種情況不該讓對話被靜靜擋下，應引導使用者走檢舉機制。
    await api(`/api/users/${receiver.id}/block`, { method: "POST", user: owner });

    const messageFromOwner = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: owner,
      body: { body: "我們約晚上七點面交" },
    });
    expect(messageFromOwner.status).toBe(201);

    const messageFromReceiver = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: receiver,
      body: { body: "好的沒問題" },
    });
    expect(messageFromReceiver.status).toBe(201);
  });
});
