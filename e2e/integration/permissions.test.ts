import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { createPublishedItem } from "../support/items";

// master-plan §6 驗收清單：
// 「重複留言被 409 擋下；B 無法接受/編輯 A 的物品（403）；未登入留言 401」
// 「非交接雙方的第三人讀取該 conversation → 404/403」
//
// 專案目前沒有通用的「編輯物品」端點（PATCH /api/items/[id] 尚未實作），所以「非物主
// 無法編輯物品」這條用另一個等效的物主專屬 mutation 驗證：POST 直贈只有物主能對自己
// 的物品發起（見 src/app/api/items/[id]/direct-shares/route.ts 的 ownerId 檢查），
// 語意上跟「B 不能對 A 的物品做只有物主能做的操作」完全對應。
describe("M1 權限與狀態機邊界", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("未登入使用者留言 → 401", async () => {
    const owner = await user("perm-owner-401");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      body: { message: "我想要這個" },
    });

    expect(res.status).toBe(401);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("同一使用者重複留言同一物品 → 409", async () => {
    const owner = await user("perm-owner-409");
    const claimer = await user("perm-claimer-409");
    const itemId = await createPublishedItem(owner);

    const first = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(first.status).toBe(201);

    const second = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "再留言一次" },
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("CONFLICT");
  });

  it("非物主對別人的物品做物主專屬操作（直贈邀請）→ 403", async () => {
    const owner = await user("perm-owner-403");
    const stranger = await user("perm-stranger-403");
    const itemId = await createPublishedItem(owner);

    const res = await api(`/api/items/${itemId}/direct-shares`, {
      method: "POST",
      user: stranger,
      body: { receiverEmail: "someone@example.com" },
    });

    expect(res.status).toBe(403);
    expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });

  it("非交接雙方的第三人讀取 conversation → 404", async () => {
    const owner = await user("perm-owner-conv404");
    const claimer = await user("perm-claimer-conv404");
    const stranger = await user("perm-stranger-conv404");
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);
    expect((claim.json as { status: string }).status).toBe("accepted");

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const { conversationId } = ensure.json as { conversationId: string };

    // 雙方都讀得到
    const ownerRead = await api(`/api/conversations/${conversationId}/messages`, { user: owner });
    expect(ownerRead.status).toBe(200);
    const claimerRead = await api(`/api/conversations/${conversationId}/messages`, {
      user: claimer,
    });
    expect(claimerRead.status).toBe(200);

    // 第三人讀不到，回 404（不是 403：連「這個 conversation 存在」都不透露，見
    // src/app/api/conversations/[id]/messages/route.ts 的註解）。
    const strangerRead = await api(`/api/conversations/${conversationId}/messages`, {
      user: stranger,
    });
    expect(strangerRead.status).toBe(404);
    expect((strangerRead.json as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
