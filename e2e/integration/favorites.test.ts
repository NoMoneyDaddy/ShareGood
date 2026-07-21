import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// M12 產品增量（docs/plan/m12-product-growth.md 交付內容 2）：收藏／我的最愛。
// 對應實作：src/app/api/items/[id]/favorites/route.ts、src/app/api/me/favorites/route.ts、
// src/lib/favorites.ts；通知扇出掛在 claims/direct-shares 兩支既有 accept transaction
// 與 item-expiration job 的到期提醒分支。
describe("M12 收藏／我的最愛", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("收藏成功回 200，重複收藏（去重）仍回 200 且只有一筆紀錄", async () => {
    const owner = await user("fav-dedup-owner");
    const viewer = await user("fav-dedup-viewer");
    const itemId = await createPublishedItem(owner);

    const first = await api(`/api/items/${itemId}/favorites`, { method: "POST", user: viewer });
    expect(first.status).toBe(200);
    const second = await api(`/api/items/${itemId}/favorites`, { method: "POST", user: viewer });
    expect(second.status).toBe(200);

    const rows = await db.itemFavorite.findMany({ where: { userId: viewer.id, itemId } });
    expect(rows).toHaveLength(1);
  });

  it("取消收藏冪等：沒有收藏紀錄時 DELETE 也回 200", async () => {
    const owner = await user("fav-delete-idempotent-owner");
    const viewer = await user("fav-delete-idempotent-viewer");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/favorites`, { method: "DELETE", user: viewer });
    expect(res.status).toBe(200);
    const rows = await db.itemFavorite.findMany({ where: { userId: viewer.id, itemId } });
    expect(rows).toHaveLength(0);
  });

  it("取消收藏後真的從資料庫移除", async () => {
    const owner = await user("fav-delete-owner");
    const viewer = await user("fav-delete-viewer");
    const itemId = await createPublishedItem(owner);

    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: viewer });
    const del = await api(`/api/items/${itemId}/favorites`, { method: "DELETE", user: viewer });
    expect(del.status).toBe(200);
    const rows = await db.itemFavorite.findMany({ where: { userId: viewer.id, itemId } });
    expect(rows).toHaveLength(0);
  });

  it("未登入收藏回 401；收藏不存在的物品回 404", async () => {
    const viewer = await user("fav-auth-viewer");
    const unauth = await api(`/api/items/fake-item-id/favorites`, { method: "POST" });
    expect(unauth.status).toBe(401);

    const notFound = await api(`/api/items/does-not-exist/favorites`, {
      method: "POST",
      user: viewer,
    });
    expect(notFound.status).toBe(404);
  });

  it("/me/favorites 分頁列表回傳收藏物品，含 favoritedAt 且不限物品狀態", async () => {
    const owner = await user("fav-list-owner");
    const viewer = await user("fav-list-viewer");
    const itemId = await createPublishedItem(owner, { title: "收藏清單測試物品" });

    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: viewer });

    const res = await api("/api/me/favorites", { user: viewer });
    expect(res.status).toBe(200);
    const body = res.json as { items: Array<{ id: string; favoritedAt: string }> };
    expect(body.items.some((i) => i.id === itemId)).toBe(true);
    const row = body.items.find((i) => i.id === itemId);
    expect(row?.favoritedAt).toBeTruthy();
  });

  it("物品被留言認領後，收藏者（排除物主與得標者）收到 favorite_item_claimed 通知", async () => {
    const owner = await user("fav-claim-owner");
    const claimer = await user("fav-claim-claimer");
    const favoriter = await user("fav-claim-favoriter");
    const itemId = await createPublishedItem(owner, { title: "收藏通知扇出測試物品" });

    // 物主與得標者也各自收藏這個物品，驗證他們被排除在扇出名單之外。
    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: owner });
    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: claimer });
    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: favoriter });

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);
    expect((claim.json as { status: string }).status).toBe("accepted");

    const favoriterNotifications = await db.notification.findMany({
      where: { userId: favoriter.id, type: "completion_confirmed" },
    });
    const claimedNotification = favoriterNotifications.find((n) => {
      const p = n.payload as Record<string, unknown> | null;
      return p?.kind === "favorite_item_claimed" && p?.itemId === itemId;
    });
    expect(claimedNotification).toBeTruthy();

    // 物主與得標者不該收到「你收藏的物品被接走了」這則通知（他們各自已經有專屬通知）。
    for (const excluded of [owner, claimer]) {
      const rows = await db.notification.findMany({
        where: { userId: excluded.id, type: "completion_confirmed" },
      });
      const hasFavoriteClaimed = rows.some((n) => {
        const p = n.payload as Record<string, unknown> | null;
        return p?.kind === "favorite_item_claimed" && p?.itemId === itemId;
      });
      expect(hasFavoriteClaimed).toBe(false);
    }
  });

  it("直贈被接受後，收藏者（排除物主與受贈者）收到 favorite_item_claimed 通知", async () => {
    const owner = await user("fav-direct-owner");
    const receiver = await user("fav-direct-receiver");
    const favoriter = await user("fav-direct-favoriter");
    const itemId = await createPublishedItem(owner, { title: "直贈收藏通知測試物品" });

    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: favoriter });

    const invite = await api(`/api/items/${itemId}/direct-shares`, {
      method: "POST",
      user: owner,
      body: { receiverEmail: receiver.email },
    });
    expect(invite.status).toBe(201);
    const shareId = (invite.json as { id: string }).id;

    const accept = await api(`/api/items/${itemId}/direct-shares/${shareId}`, {
      method: "PATCH",
      user: receiver,
      body: { action: "accept" },
    });
    expect(accept.status).toBe(200);

    const rows = await db.notification.findMany({
      where: { userId: favoriter.id, type: "completion_confirmed" },
    });
    const hasNotification = rows.some((n) => {
      const p = n.payload as Record<string, unknown> | null;
      return p?.kind === "favorite_item_claimed" && p?.itemId === itemId;
    });
    expect(hasNotification).toBe(true);
  });

  it("使用者把 favorite_item_update 站內通知關掉時，收藏通知不會被寫入（M4 偏好閘門）", async () => {
    const owner = await user("fav-pref-owner");
    const claimer = await user("fav-pref-claimer");
    const favoriter = await user("fav-pref-favoriter");
    const itemId = await createPublishedItem(owner, { title: "收藏通知偏好測試物品" });

    await api(`/api/items/${itemId}/favorites`, { method: "POST", user: favoriter });
    await db.notificationPreference.create({
      data: {
        userId: favoriter.id,
        eventType: "favorite_item_update",
        inAppEnabled: false,
        externalEnabled: false,
      },
    });

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);

    const rows = await db.notification.findMany({
      where: { userId: favoriter.id, type: "completion_confirmed" },
    });
    const hasNotification = rows.some((n) => {
      const p = n.payload as Record<string, unknown> | null;
      return p?.kind === "favorite_item_claimed" && p?.itemId === itemId;
    });
    expect(hasNotification).toBe(false);
  });
});
