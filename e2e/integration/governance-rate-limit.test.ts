import { afterAll, afterEach, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createImagePair } from "../support/images";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

// master-plan §7 驗收清單相關：
// 「rate limit 生效：第 N+1 次留言回 429」
// 「打開 REQUIRE_REVIEW flag：新上架進審核佇列、通過後才公開」
//
// 對應實作：src/lib/rate-limit.ts、src/lib/keyword-blocklist.ts、src/lib/feature-flags.ts，
// 掛載點：POST /api/items、POST /api/items/[id]/claims、POST /api/conversations/[id]/messages、
// POST /api/uploads。
describe("M2 rate limit / 關鍵字黑名單 / feature flag", () => {
  const userIds: string[] = [];
  const keywordIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  afterEach(async () => {
    // 每個 flag/keyword 都是全站共用設定，測試結束一律清掉，避免影響同檔案內其他測試
    // 或之後才跑到的測試檔（vitest.config.ts 設了 fileParallelism:false，同一時間只有一個
    // 檔案在跑，但檔案之間仍共用同一個資料庫）。
    await db.featureFlag.deleteMany({ where: { key: "REQUIRE_REVIEW" } });
    if (keywordIds.length > 0) {
      await db.keywordBlocklist.deleteMany({ where: { id: { in: keywordIds } } });
      keywordIds.length = 0;
    }
  });

  it("上架 rate limit：第 6 次（超過每小時 5 次上限）回 429", async () => {
    const owner = await user("rl-item-owner");
    const { cityId, categoryId } = await pickCityAndCategory();

    for (let i = 0; i < 5; i++) {
      const images = await createImagePair(owner.id);
      const res = await api("/api/items", {
        method: "POST",
        user: owner,
        body: {
          title: `rate limit 測試物品 ${i}`,
          description: "測試上架 rate limit 用的假物品描述",
          categoryId,
          cityId,
          images: [images],
        },
      });
      expect(res.status).toBe(201);
    }

    const images = await createImagePair(owner.id);
    const sixth = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "rate limit 測試物品 5",
        description: "測試上架 rate limit 用的假物品描述",
        categoryId,
        cityId,
        images: [images],
      },
    });
    expect(sixth.status).toBe(429);
    expect((sixth.json as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });

  it("留言 rate limit：第 21 次（超過每小時 20 次上限）回 429，且不多寫入一筆留言", async () => {
    const claimer = await user("rl-claim-claimer");
    const itemOwner = await user("rl-claim-owner");

    // 用直接寫 DB 的方式造出 20 個不同物品讓同一人各留言一次，避開上架本身的
    // item_create rate limit（每小時只有 5 次），rate limit 計算只看
    // claim_comments.count(userId, since)，跟物品是誰的、有幾筆無關。
    const { cityId, categoryId } = await pickCityAndCategory();
    const itemIds: string[] = [];
    for (let i = 0; i < 21; i++) {
      const item = await db.item.create({
        data: {
          ownerId: itemOwner.id,
          title: `rl-claim-item-${i}`,
          description: "留言 rate limit 測試用物品",
          categoryId,
          cityId,
          status: "published",
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      itemIds.push(item.id);
    }

    for (let i = 0; i < 20; i++) {
      const res = await api(`/api/items/${itemIds[i]}/claims`, {
        method: "POST",
        user: claimer,
        body: { message: `第 ${i} 則留言` },
      });
      expect(res.status).toBe(201);
    }

    const overLimit = await api(`/api/items/${itemIds[20]}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "第 21 則留言，應該被擋" },
    });
    expect(overLimit.status).toBe(429);
    expect((overLimit.json as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

    const claimCount = await db.claimComment.count({
      where: { itemId: itemIds[20], userId: claimer.id },
    });
    expect(claimCount).toBe(0); // 被擋下的請求沒有留下任何副作用
  });

  it("關鍵字黑名單：上架標題命中黑名單關鍵字 → 422，不建立物品", async () => {
    const owner = await user("blocklist-item-owner");
    const keyword = await db.keywordBlocklist.create({
      data: { keyword: "私下加賴詐騙測試關鍵字", isActive: true },
    });
    keywordIds.push(keyword.id);

    const { cityId, categoryId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);
    const beforeCount = await db.item.count({ where: { ownerId: owner.id } });

    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "含有私下加賴詐騙測試關鍵字的標題",
        description: "正常描述",
        categoryId,
        cityId,
        images: [images],
      },
    });
    expect(res.status).toBe(422);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNPROCESSABLE");

    const afterCount = await db.item.count({ where: { ownerId: owner.id } });
    expect(afterCount).toBe(beforeCount); // 沒有誤建立物品
  });

  it("關鍵字黑名單：停用（isActive=false）的關鍵字不擋", async () => {
    const owner = await user("blocklist-inactive-owner");
    const keyword = await db.keywordBlocklist.create({
      data: { keyword: "已停用黑名單關鍵字測試", isActive: false },
    });
    keywordIds.push(keyword.id);

    const { cityId, categoryId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);

    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "含有已停用黑名單關鍵字測試的標題",
        description: "正常描述",
        categoryId,
        cityId,
        images: [images],
      },
    });
    expect(res.status).toBe(201);
  });

  it("關鍵字黑名單：留言內容命中黑名單 → 422，不建立留言", async () => {
    const owner = await user("blocklist-claim-owner");
    const claimer = await user("blocklist-claim-claimer");
    const itemId = await createPublishedItem(owner);
    const keyword = await db.keywordBlocklist.create({
      data: { keyword: "加賴私訊付款測試關鍵字", isActive: true },
    });
    keywordIds.push(keyword.id);

    const res = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我們加賴私訊付款測試關鍵字好嗎" },
    });
    expect(res.status).toBe(422);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNPROCESSABLE");

    const claimCount = await db.claimComment.count({ where: { itemId, userId: claimer.id } });
    expect(claimCount).toBe(0);
  });

  it("REQUIRE_REVIEW 關閉（預設）：新上架直接 published，列表與詳情頁都看得到", async () => {
    const owner = await user("flag-off-owner");
    const itemId = await createPublishedItem(owner);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const list = await api("/api/items?limit=50");
    const listBody = list.json as { items: Array<{ id: string }> };
    expect(listBody.items.some((i) => i.id === itemId)).toBe(true);
  });

  it("REQUIRE_REVIEW 開啟：新上架進 pending_review，不進公開列表；審核通過（改回 published）後才進列表", async () => {
    const owner = await user("flag-on-owner");
    await db.featureFlag.create({
      data: { key: "REQUIRE_REVIEW", enabled: true },
    });

    const { cityId, categoryId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);
    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "REQUIRE_REVIEW 開啟時上架的物品",
        description: "應該先進 pending_review",
        categoryId,
        cityId,
        images: [images],
      },
    });
    expect(res.status).toBe(201);
    const itemId = (res.json as { id: string }).id;

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("pending_review");
    expect(item.publishedAt).toBeNull();

    const statusLog = await db.itemStatusLog.findFirst({
      where: { itemId, toStatus: "pending_review" },
    });
    expect(statusLog).not.toBeNull();
    expect(statusLog?.fromStatus).toBeNull();

    // 審核佇列 UI（/admin）不在這個任務範圍內，這裡直接用「改狀態」模擬 admin 審核通過的效果，
    // 驗證的重點是：pending_review 不會出現在公開列表，published 之後才會。
    const listBeforeApprove = await api("/api/items?limit=50");
    const listBeforeBody = listBeforeApprove.json as { items: Array<{ id: string }> };
    expect(listBeforeBody.items.some((i) => i.id === itemId)).toBe(false);

    const strangerRead = await api(`/items/${itemId}`);
    expect(strangerRead.status).toBe(404);

    // 物主自己能通過 pending_review 的可見性檢查（不是 404）。這裡不斷言完整 200 SSR
    // 成功，因為這個沙盒環境的 S3_PUBLIC_URL 帶了 bucket 路徑（.../sharegood/images/...），
    // 跟 next.config.ts 的 remotePatterns pathname（/images/**）對不上，導致 next/image
    // 對任何有真圖片的物品詳情頁都會 500——這是既有、跟本次 REQUIRE_REVIEW 改動無關的
    // 環境設定問題（e2e/integration/seo.test.ts 對 published 物品也會踩到同一個問題），
    // 不在這個任務範圍內修正。這裡只驗證「不是 404」，藉此跟上面 stranger 的 404 做區隔。
    const ownerRead = await api(`/items/${itemId}`, { user: owner });
    expect(ownerRead.status).not.toBe(404);

    await db.item.update({
      where: { id: itemId },
      data: { status: "published", publishedAt: new Date() },
    });

    const listAfterApprove = await api("/api/items?limit=50");
    const listAfterBody = listAfterApprove.json as { items: Array<{ id: string }> };
    expect(listAfterBody.items.some((i) => i.id === itemId)).toBe(true);
  });
});
