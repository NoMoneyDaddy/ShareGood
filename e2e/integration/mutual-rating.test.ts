import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// M12 交付內容 1（雙向互評，docs/plan/m12-product-growth.md）：交接完成後物主與接手者
// 各自可對另一方留一次 1–5 星評分＋可選評語，雙盲揭露（雙方都評完前互看不到內容）。
describe("M12 交付內容 1：雙向互評", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  }, 60_000);

  /** 走完整條主迴路把物品推到 completed，回傳 handoverId。 */
  async function completeHandover(owner: TestUser, receiver: TestUser): Promise<string> {
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);

    const handover = await db.handoverRecord.findUniqueOrThrow({ where: { itemId } });

    const ownerComplete = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: owner,
    });
    expect(ownerComplete.status).toBe(200);
    const receiverComplete = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: receiver,
    });
    expect(receiverComplete.status).toBe(200);
    expect((receiverComplete.json as { status: string }).status).toBe("completed");

    return handover.id;
  }

  it("交接未完成時評分 → 409", async () => {
    const owner = await user("rating-notdone-owner");
    const receiver = await user("rating-notdone-receiver");
    const itemId = await createPublishedItem(owner);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這個" },
    });
    expect(claim.status).toBe(201);
    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const handover = await db.handoverRecord.findUniqueOrThrow({ where: { itemId } });

    const res = await api(`/api/handover/${handover.id}/ratings`, {
      method: "POST",
      user: owner,
      body: { stars: 5 },
    });
    expect(res.status).toBe(409);
    expect((res.json as { error: { code: string } }).error.code).toBe("CONFLICT");
  });

  it("stars 超出 1–5 範圍 → 422", async () => {
    const owner = await user("rating-range-owner");
    const receiver = await user("rating-range-receiver");
    const handoverId = await completeHandover(owner, receiver);

    for (const bad of [0, 6, 2.5, -1]) {
      const res = await api(`/api/handover/${handoverId}/ratings`, {
        method: "POST",
        user: owner,
        body: { stars: bad },
      });
      expect(res.status, `stars=${bad} 應該回 422`).toBe(422);
    }
  });

  it("評語命中關鍵字黑名單 → 422", async () => {
    const owner = await user("rating-blocklist-owner");
    const receiver = await user("rating-blocklist-receiver");
    const handoverId = await completeHandover(owner, receiver);

    const keyword = await db.keywordBlocklist.findFirst({ where: { isActive: true } });
    if (!keyword) throw new Error("測試需要 seed 資料裡至少一筆啟用中的關鍵字黑名單");

    const res = await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: owner,
      body: { stars: 5, comment: `評語含有${keyword.keyword}這個詞` },
    });
    expect(res.status).toBe(422);
  });

  it("非參與者評分 → 403", async () => {
    const owner = await user("rating-stranger-owner");
    const receiver = await user("rating-stranger-receiver");
    const stranger = await user("rating-stranger-outsider");
    const handoverId = await completeHandover(owner, receiver);

    const res = await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: stranger,
      body: { stars: 4 },
    });
    expect(res.status).toBe(403);
  });

  it("雙方各自評分一次成功；第二次撞 unique 回 409；雙盲揭露——對方未評分前看不到內容，雙方都評完才互看得到", async () => {
    const owner = await user("rating-flow-owner");
    const receiver = await user("rating-flow-receiver");
    const handoverId = await completeHandover(owner, receiver);

    // 物主先評分。
    const ownerRate = await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: owner,
      body: { stars: 5, comment: "很順利的交接！" },
    });
    expect(ownerRate.status).toBe(201);

    // 物主重複評分同一筆交接 → 409。
    const ownerRateAgain = await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: owner,
      body: { stars: 3 },
    });
    expect(ownerRateAgain.status).toBe(409);
    expect((ownerRateAgain.json as { error: { code: string } }).error.code).toBe("CONFLICT");

    // 物主此時查詢：mine 有內容，other 因為接手者還沒評分，仍是 null（雙盲）。
    const ownerViewBefore = await api(`/api/handover/${handoverId}/ratings`, { user: owner });
    expect(ownerViewBefore.status).toBe(200);
    const beforeJson = ownerViewBefore.json as { mine: unknown; other: unknown };
    expect(beforeJson.mine).not.toBeNull();
    expect(beforeJson.other).toBeNull();

    // 接手者此時查詢：即使物主已經評分，接手者自己還沒評分，other 仍是 null
    // （雙盲防報復性評分：不能因為自己還沒評分就先偷看對方內容）。
    const receiverViewBefore = await api(`/api/handover/${handoverId}/ratings`, {
      user: receiver,
    });
    const beforeReceiverJson = receiverViewBefore.json as { mine: unknown; other: unknown };
    expect(beforeReceiverJson.mine).toBeNull();
    expect(beforeReceiverJson.other).toBeNull();

    // 接手者評分。
    const receiverRate = await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: receiver,
      body: { stars: 4 },
    });
    expect(receiverRate.status).toBe(201);

    // 雙方都評完後，雙方都能看到對方的內容。
    const ownerViewAfter = await api(`/api/handover/${handoverId}/ratings`, { user: owner });
    const afterOwnerJson = ownerViewAfter.json as {
      mine: { stars: number };
      other: { stars: number } | null;
    };
    expect(afterOwnerJson.mine.stars).toBe(5);
    expect(afterOwnerJson.other?.stars).toBe(4);

    const receiverViewAfter = await api(`/api/handover/${handoverId}/ratings`, {
      user: receiver,
    });
    const afterReceiverJson = receiverViewAfter.json as {
      mine: { stars: number };
      other: { stars: number } | null;
    };
    expect(afterReceiverJson.mine.stars).toBe(4);
    expect(afterReceiverJson.other?.stars).toBe(5);
  });

  it("個人頁與物品詳情頁平均星等：無評分顯示對應空狀態文字（非 0 星誤導），有評分後數字正確", async () => {
    const owner = await user("rating-profile-owner");
    const receiver = await user("rating-profile-receiver");

    // 物品詳情頁物主資訊列（無評分顯示「尚無評分」，見 items/[id]/page.tsx）。
    const itemForTrustSignal = await createPublishedItem(owner);
    const detailBefore = await api(`/items/${itemForTrustSignal}`);
    expect(detailBefore.status).toBe(200);
    expect(String(detailBefore.json)).toContain("尚無評分");

    // 個人頁第四格「平均評分」（無評分顯示「－」，見 u/[userId]/page.tsx）。
    const profileBefore = await api(`/u/${owner.id}`);
    expect(profileBefore.status).toBe(200);
    expect(String(profileBefore.json)).toContain("－");

    const handoverId = await completeHandover(owner, receiver);
    await api(`/api/handover/${handoverId}/ratings`, {
      method: "POST",
      user: receiver,
      body: { stars: 5 },
    });

    const profileAfter = await api(`/u/${owner.id}`);
    expect(profileAfter.status).toBe(200);
    expect(String(profileAfter.json)).toContain("★5.0");
    expect(String(profileAfter.json)).toContain("1 則");
  });
});
