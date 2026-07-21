import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createImagePair } from "../support/images";
import { pickCityAndCategory } from "../support/items";

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：POST /api/items/batch。
// 驗收要點：批量建立 3–10 筆成功，全部進資料庫；任一筆標題過短時整批不建立、回傳正確的
// details 索引；選到券/食品/票/點分類時擋下；item_create_batch 門檻與 item_create 各自
// 獨立生效（互不放寬對方）；圖片搶用沿用既有防呆機制。
describe("M12 交付內容 7：POST /api/items/batch", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function batchBody(owner: TestUser, count: number, categoryId: string, cityId: string) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const images = await createImagePair(owner.id);
      items.push({
        title: `批量測試物品-${Date.now()}-${i}`,
        description: "整合測試用的批量物品描述",
        images: [images],
      });
    }
    return { categoryId, cityId, items };
  }

  it("批量建立 3 筆成功，全部進資料庫、狀態為 published、依輸入順序回傳", async () => {
    const owner = await user("batch-ok-owner");
    const { cityId, categoryId } = await pickCityAndCategory();
    const body = await batchBody(owner, 3, categoryId, cityId);

    const res = await api("/api/items/batch", { method: "POST", user: owner, body });
    expect(res.status).toBe(201);
    const created = (res.json as { items: Array<{ id: string; title: string }> }).items;
    expect(created).toHaveLength(3);
    expect(created.map((c) => c.title)).toEqual(body.items.map((i) => i.title));

    for (const c of created) {
      const row = await db.item.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.status).toBe("published");
      expect(row.ownerId).toBe(owner.id);
      expect(row.categoryId).toBe(categoryId);
      const images = await db.itemImage.findMany({ where: { itemId: c.id } });
      expect(images).toHaveLength(1);
    }
  });

  it("任一筆標題過短時整批不建立，回傳 422 與正確的 details 索引", async () => {
    const owner = await user("batch-invalid-owner");
    const { cityId, categoryId } = await pickCityAndCategory();
    const body = await batchBody(owner, 3, categoryId, cityId);
    // 第二筆（index 1）標題故意設成只有 1 個字，低於 2–60 字下限。
    body.items[1].title = "a";

    const before = await db.item.count({ where: { ownerId: owner.id } });
    const res = await api("/api/items/batch", { method: "POST", user: owner, body });
    expect(res.status).toBe(422);
    const errorBody = res.json as { error: { code: string; details: Array<{ index: number; message: string }> } };
    expect(errorBody.error.code).toBe("UNPROCESSABLE");
    expect(errorBody.error.details).toHaveLength(1);
    expect(errorBody.error.details[0].index).toBe(1);

    // 整批都沒有建立（不是「部分成功」）。
    const after = await db.item.count({ where: { ownerId: owner.id } });
    expect(after).toBe(before);
  });

  it("選到優惠券／即期食品／票券／點數分類時整批擋下（422）", async () => {
    const owner = await user("batch-special-owner");
    const { cityId } = await pickCityAndCategory();
    const specialSlugs = ["coupons", "groceries", "tickets", "points"];

    for (const slug of specialSlugs) {
      const category = await db.category.findFirstOrThrow({ where: { slug } });
      const body = await batchBody(owner, 2, category.id, cityId);
      const res = await api("/api/items/batch", { method: "POST", user: owner, body });
      expect(res.status).toBe(422);
    }
  });

  it("items 數量超過 10 筆或為 0 筆時回 422", async () => {
    const owner = await user("batch-count-owner");
    const { cityId, categoryId } = await pickCityAndCategory();

    const tooMany = await batchBody(owner, 11, categoryId, cityId);
    const tooManyRes = await api("/api/items/batch", { method: "POST", user: owner, body: tooMany });
    expect(tooManyRes.status).toBe(422);

    const empty = { categoryId, cityId, items: [] };
    const emptyRes = await api("/api/items/batch", { method: "POST", user: owner, body: empty });
    expect(emptyRes.status).toBe(422);
  });

  it("同一批次內兩筆共用同一張圖片 → 422，不建立任何物品", async () => {
    const owner = await user("batch-dup-image-owner");
    const { cityId, categoryId } = await pickCityAndCategory();
    const sharedImages = await createImagePair(owner.id);

    const before = await db.item.count({ where: { ownerId: owner.id } });
    const res = await api("/api/items/batch", {
      method: "POST",
      user: owner,
      body: {
        categoryId,
        cityId,
        items: [
          { title: "共用圖片測試 A", description: "測試描述 A", images: [sharedImages] },
          { title: "共用圖片測試 B", description: "測試描述 B", images: [sharedImages] },
        ],
      },
    });
    expect(res.status).toBe(422);
    const after = await db.item.count({ where: { ownerId: owner.id } });
    expect(after).toBe(before);
  });

  it("圖片已被別的物品用掉（status 非 pending）→ 422，整批不建立", async () => {
    const owner = await user("batch-used-image-owner");
    const { cityId, categoryId } = await pickCityAndCategory();
    const usedImages = await createImagePair(owner.id);

    // 先用單筆端點把這組圖片用掉（status: pending → linked）。
    const singleRes = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "已上架的物品",
        description: "先用掉這組圖片",
        categoryId,
        cityId,
        images: [usedImages],
      },
    });
    expect(singleRes.status).toBe(201);

    const before = await db.item.count({ where: { ownerId: owner.id } });
    const res = await api("/api/items/batch", {
      method: "POST",
      user: owner,
      body: {
        categoryId,
        cityId,
        items: [{ title: "重用已用掉的圖片", description: "應該被擋下", images: [usedImages] }],
      },
    });
    expect(res.status).toBe(422);
    const after = await db.item.count({ where: { ownerId: owner.id } });
    expect(after).toBe(before);
  });

  it("未登入 → 401", async () => {
    const { cityId, categoryId } = await pickCityAndCategory();
    const anonRes = await api("/api/items/batch", {
      method: "POST",
      body: { categoryId, cityId, items: [] },
    });
    expect(anonRes.status).toBe(401);
  });

  it("item_create_batch 門檻（30/hour）與既有 item_create 門檻（5/hour）各自獨立生效", async () => {
    const owner = await user("batch-rate-limit-owner");
    const { cityId, categoryId } = await pickCityAndCategory();

    // 直接在 DB 造 30 筆該使用者名下最近建立的物品，模擬「這小時已經用滿批量額度」——
    // counter 查詢（db.item.count({ ownerId, createdAt: gte })）跟建立路徑無關，用哪種
    // 方式造出這 30 筆都一樣，直接寫 DB 比迴圈打 30 次 API＋上傳圖片快很多。
    await db.item.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        ownerId: owner.id,
        title: `rate-limit-batch-seed-${i}`,
        description: "批量 rate limit 測試種子資料",
        categoryId,
        cityId,
        status: "published" as const,
      })),
    });

    const body = await batchBody(owner, 1, categoryId, cityId);
    const res = await api("/api/items/batch", { method: "POST", user: owner, body });
    expect(res.status).toBe(429);
    expect((res.json as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });

  it("批量入口不會放寬單筆 item_create 門檻：批量用掉額度後，單筆 POST /api/items 一樣受限於自己的 5/hour", async () => {
    const owner = await user("batch-no-cross-relax-owner");
    const { cityId, categoryId } = await pickCityAndCategory();

    // 造 5 筆（剛好等於既有 item_create 每小時上限），單筆端點應該立刻被擋，
    // 即使距離批量的 30/hour 上限還很遠——證明兩個門檻各自對各自的呼叫路徑生效。
    await db.item.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        ownerId: owner.id,
        title: `rate-limit-single-seed-${i}`,
        description: "單筆 rate limit 測試種子資料",
        categoryId,
        cityId,
        status: "published" as const,
      })),
    });

    const images = await createImagePair(owner.id);
    const singleRes = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "單筆上架應該被擋",
        description: "測試單筆門檻不受批量門檻放寬",
        categoryId,
        cityId,
        images: [images],
      },
    });
    expect(singleRes.status).toBe(429);

    // 但批量端點（30/hour）此時完全沒問題，因為只用掉 5 筆額度。
    const batchOkBody = await batchBody(owner, 2, categoryId, cityId);
    const batchRes = await api("/api/items/batch", { method: "POST", user: owner, body: batchOkBody });
    expect(batchRes.status).toBe(201);
  });
});
