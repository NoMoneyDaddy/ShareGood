import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDailyLimit } from "@/lib/give-to-get-quota";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, grantRole, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createImagePair } from "../support/images";
import { createPublishedItem, pickCityAndCategory } from "../support/items";

// master-plan.md §9a 交付內容 3（券類強化）驗收清單相關：
// 「give-to-get 領取配額：低貢獻值帳號在當日額度用盡後，第 N+1 次券類認領回 429；
//   分享過券提高額度後可繼續；實體物品的認領完全不受配額影響。」
// 「券使用結果回報：同一使用者對同一券回報兩次 → 第二次被 unique 擋下；聚合統計正確；
//   文案無「保證有效/保證可兌換」字樣。」
// 「不可上架清單：以「LINE 即享券」「隨買跨店取」為標題/券種上架 → 422。」
// 「/admin/keyword-blocklist：moderator/admin 可 CRUD 詞條、異動寫 audit_logs；
//   非 moderator/admin 存取 → 404/403。」
//
// 對應實作：src/lib/give-to-get-quota.ts、src/app/api/items/[id]/claims/route.ts、
// src/app/api/items/[id]/coupon-usage-reports/route.ts、
// src/lib/non-transferable-coupon-types.ts、src/app/api/items/route.ts、
// src/app/api/admin/keyword-blocklist[/id]/route.ts。
describe("M9 give-to-get 領取配額分級（單元）", () => {
  it("分數落在多個級距之間取門檻最高的那個（剛好達標 vs 差 1 分）", () => {
    expect(resolveDailyLimit(0)).toBe(1);
    expect(resolveDailyLimit(9)).toBe(1); // 差 1 分未達 10 分門檻
    expect(resolveDailyLimit(10)).toBe(3); // 剛好達標 10 分門檻
    expect(resolveDailyLimit(49)).toBe(3); // 差 1 分未達 50 分門檻
    expect(resolveDailyLimit(50)).toBe(10); // 剛好達標 50 分門檻
    expect(resolveDailyLimit(1000)).toBe(10);
  });
});

describe("M9 give-to-get 領取配額（券票點類物品）", () => {
  const userIds: string[] = [];
  let couponCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "coupons" } });
    couponCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  function tomorrow(): string {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function couponOwner(label: string, title: string) {
    const owner = await user(label);
    const itemId = await createPublishedItem(owner, {
      title,
      categoryId: couponCategoryId,
      expiresAt: tomorrow(),
      coupon: { faceValue: "$50 折價", merchantName: "配額測試商店", code: `CODE-${Date.now()}` },
    });
    return itemId;
  }

  it("貢獻值 0 分的帳號當日額度為 1：第 2 次認領券類物品 → 429；分享過券提高額度後可繼續", async () => {
    const claimer = await user("quota-claimer");
    const item1 = await couponOwner("quota-owner-1", `配額測試券-1-${Date.now()}`);
    const item2 = await couponOwner("quota-owner-2", `配額測試券-2-${Date.now()}`);
    const item3 = await couponOwner("quota-owner-3", `配額測試券-3-${Date.now()}`);

    // 第 1 次認領：額度內，成功。
    const first = await api(`/api/items/${item1}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這張券" },
    });
    expect(first.status).toBe(201);

    // 第 2 次認領（不同物品）：額度已用盡（每日限 1 次）→ 429。
    const second = await api(`/api/items/${item2}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我還想要這張券" },
    });
    expect(second.status).toBe(429);
    expect((second.json as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

    // 沒有留言紀錄被誤建立（被擋下的請求不該有副作用）。
    const claimOnItem2 = await db.claimComment.findFirst({
      where: { itemId: item2, userId: claimer.id },
    });
    expect(claimOnItem2).toBeNull();

    // 分享過券（模擬完成一次分享，貢獻值 +10，達到第二級距門檻）後，額度提高為 3，
    // 可以繼續認領第三個券類物品。
    await db.contributionEvent.create({
      data: { userId: claimer.id, type: "share_completed", points: 10 },
    });
    const third = await api(`/api/items/${item3}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "額度提高後再試一次" },
    });
    expect(third.status).toBe(201);
  });

  it("declined 的認領不佔每日額度（先到先得搶輸不吃掉配額）", async () => {
    const claimer = await user("quota-declined-claimer");
    const lostItem = await couponOwner("quota-declined-owner-1", `搶輸的券-${Date.now()}`);
    const freshItem = await couponOwner("quota-declined-owner-2", `還能認領的券-${Date.now()}`);

    // 直接模擬「慢了一步」分支留下的 declined 紀錄（claims/route.ts 對已被搶走的物品
    // 會建立 status=declined 的留言後回 409）。
    await db.claimComment.create({
      data: { itemId: lostItem, userId: claimer.id, message: "慢了一步", status: "declined" },
    });

    // 貢獻值 0 分、每日額度 1：declined 那筆若被誤算，這裡會 429。
    const res = await api(`/api/items/${freshItem}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "搶輸不該佔額度" },
    });
    expect(res.status).toBe(201);
  });

  it("實體物品的認領完全不受券票點配額影響（同一使用者已用盡券類額度仍可正常認領實體物品）", async () => {
    const claimer = await user("quota-control-claimer");
    const couponItem = await couponOwner("quota-control-coupon-owner", `配額對照券-${Date.now()}`);

    const claimCoupon = await api(`/api/items/${couponItem}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "先用掉券類額度" },
    });
    expect(claimCoupon.status).toBe(201);

    const { cityId, categoryId } = await pickCityAndCategory();
    const plainOwner = await user("quota-control-plain-owner");
    const plainItemId = await createPublishedItem(plainOwner, { cityId, categoryId });

    const claimPlain = await api(`/api/items/${plainItemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "實體物品不受券類配額影響" },
    });
    expect(claimPlain.status).toBe(201);
  });
});

describe("M9 優惠券使用結果回報", () => {
  const userIds: string[] = [];
  let couponCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "coupons" } });
    couponCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  function tomorrow(): string {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  async function setUpHandover(ownerLabel: string, receiverLabel: string) {
    const owner = await user(ownerLabel);
    const receiver = await user(receiverLabel);
    const itemId = await createPublishedItem(owner, {
      categoryId: couponCategoryId,
      expiresAt: tomorrow(),
      coupon: { faceValue: "$100 折價", merchantName: "回報測試商店", code: `CODE-${Date.now()}` },
    });
    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這張券" },
    });
    expect(claim.status).toBe(201);
    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: receiver,
    });
    expect(ensure.status).toBe(200);
    return { owner, receiver, itemId };
  }

  it("接手者可回報使用結果，同一人回報第二次 → 409；聚合統計正確", async () => {
    const { receiver, itemId } = await setUpHandover("usage-owner-1", "usage-receiver-1");

    const first = await api(`/api/items/${itemId}/coupon-usage-reports`, {
      method: "POST",
      user: receiver,
      body: { result: "usable" },
    });
    expect(first.status).toBe(201);

    const second = await api(`/api/items/${itemId}/coupon-usage-reports`, {
      method: "POST",
      user: receiver,
      body: { result: "expired_or_used" },
    });
    expect(second.status).toBe(409);
    expect((second.json as { error: { code: string } }).error.code).toBe("CONFLICT");

    // 聚合統計正確：只有一筆 usable，沒有 expired_or_used（第二次被擋下沒有寫入）。
    const stats = await api(`/api/items/${itemId}/coupon-usage-reports`);
    expect(stats.status).toBe(200);
    expect(stats.json).toEqual({ usable: 1, expired_or_used: 0 });
  });

  it("物主（非接手者）不能回報 → 403；交接尚未確定時回報 → 409", async () => {
    const owner = await user("usage-owner-2");
    const receiver = await user("usage-receiver-2");
    const itemId = await createPublishedItem(owner, {
      categoryId: couponCategoryId,
      expiresAt: tomorrow(),
      coupon: { faceValue: "$80 折價", merchantName: "回報測試商店 2", code: `CODE-${Date.now()}` },
    });

    // 交接還沒確定（還是 published）：回報 → 409。
    const tooEarly = await api(`/api/items/${itemId}/coupon-usage-reports`, {
      method: "POST",
      user: owner,
      body: { result: "usable" },
    });
    expect(tooEarly.status).toBe(409);

    const claim = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這張券" },
    });
    expect(claim.status).toBe(201);
    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: receiver,
    });
    expect(ensure.status).toBe(200);

    const byOwner = await api(`/api/items/${itemId}/coupon-usage-reports`, {
      method: "POST",
      user: owner,
      body: { result: "usable" },
    });
    expect(byOwner.status).toBe(403);
  });

  it("非優惠券物品回報 → 404；未登入 → 401", async () => {
    const { cityId, categoryId } = await pickCityAndCategory();
    const owner = await user("usage-plain-owner");
    const plainItemId = await createPublishedItem(owner, { cityId, categoryId });

    const notCoupon = await api(`/api/items/${plainItemId}/coupon-usage-reports`, {
      method: "POST",
      user: owner,
      body: { result: "usable" },
    });
    expect(notCoupon.status).toBe(404);

    const unauthorized = await api(`/api/items/${plainItemId}/coupon-usage-reports`, {
      method: "POST",
      body: { result: "usable" },
    });
    expect(unauthorized.status).toBe(401);
  });
});

describe("M9 不可上架清單（官方明文禁轉贈／官方閉環券種）", () => {
  const userIds: string[] = [];
  let couponCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "coupons" } });
    couponCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  function tomorrow(): string {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  it("標題含「LINE 即享券」/「隨買跨店取」→ 422（各種空白/半形變體皆被正規化攔截）", async () => {
    const owner = await user("blocklist-title-owner");
    const { cityId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);

    for (const title of ["LINE 即享券", "line即享券", "全家隨買跨店取"]) {
      const res = await api("/api/items", {
        method: "POST",
        user: owner,
        body: {
          title,
          description: "不應該建立成功",
          categoryId: couponCategoryId,
          cityId,
          images: [images],
          expiresAt: tomorrow(),
          coupon: { faceValue: "$50", merchantName: "測試商店", code: `CODE-${Date.now()}` },
        },
      });
      expect(res.status).toBe(422);
    }
  });

  it("通用「即享券」（無 LINE 前綴）不被誤殺：麥當勞即享券可正常上架", async () => {
    // 回歸防護：裸詞「即享券」是 Edenred 通用票券品牌，多數可自由轉贈，
    // 只有 LINE 即享券官方禁轉贈（研究 04）。層一常數清單與層二 seed 詞庫都不得收裸詞。
    const owner = await user("blocklist-edenred-owner");
    const { cityId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);

    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "麥當勞即享券 大麥克買一送一",
        description: "序號券，可自由轉贈",
        categoryId: couponCategoryId,
        cityId,
        images: [images],
        expiresAt: tomorrow(),
        coupon: { faceValue: "買一送一", merchantName: "麥當勞", code: `CODE-${Date.now()}` },
      },
    });
    expect(res.status).toBe(201);
  });

  it("店家欄位命中不可上架清單也會被擋（不只檢查標題）", async () => {
    const owner = await user("blocklist-merchant-owner");
    const { cityId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);

    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "普通優惠券分享",
        description: "店家欄位含禁止券種",
        categoryId: couponCategoryId,
        cityId,
        images: [images],
        expiresAt: tomorrow(),
        coupon: {
          faceValue: "$50",
          merchantName: "7-ELEVEN 行動隨時取",
          code: `CODE-${Date.now()}`,
        },
      },
    });
    expect(res.status).toBe(422);
  });

  it("正常券種（不含禁止清單詞彙）仍可正常上架，確認攔截沒有誤傷", async () => {
    const owner = await user("blocklist-control-owner");
    const { cityId } = await pickCityAndCategory();
    const images = await createImagePair(owner.id);

    const res = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: "全聯禮券分享",
        description: "普通實體禮券，沒有官方禁轉贈限制",
        categoryId: couponCategoryId,
        cityId,
        images: [images],
        expiresAt: tomorrow(),
        coupon: { faceValue: "$100", merchantName: "全聯福利中心", code: `CODE-${Date.now()}` },
      },
    });
    expect(res.status).toBe(201);
  });
});

describe("M9 /admin/keyword-blocklist CRUD", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function moderator(label: string): Promise<TestUser> {
    const u = await user(label);
    await grantRole(u.id, "moderator");
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("moderator 可新增詞條、寫入 audit_logs；重複新增同一關鍵字 → 409", async () => {
    const mod = await moderator("kb-crud-mod");
    const keyword = `測試關鍵字-${Date.now()}`;

    const create = await api("/api/admin/keyword-blocklist", {
      method: "POST",
      user: mod,
      body: { keyword },
    });
    expect(create.status).toBe(201);
    const { id } = create.json as { id: string; isActive: boolean };
    expect((create.json as { isActive: boolean }).isActive).toBe(true);

    const auditLog = await db.auditLog.findFirst({
      where: { action: "keyword_blocklist.create", targetId: id },
    });
    expect(auditLog).not.toBeNull();

    const duplicate = await api("/api/admin/keyword-blocklist", {
      method: "POST",
      user: mod,
      body: { keyword },
    });
    expect(duplicate.status).toBe(409);
  });

  it("moderator 可停用詞條並立即在上架攔截生效，重新啟用後恢復攔截", async () => {
    const mod = await moderator("kb-crud-toggle-mod");
    const owner = await user("kb-crud-toggle-owner");
    const keyword = `專屬測試詞-${Date.now()}`;

    const create = await api("/api/admin/keyword-blocklist", {
      method: "POST",
      user: mod,
      body: { keyword },
    });
    expect(create.status).toBe(201);
    const { id } = create.json as { id: string };

    const { cityId, categoryId } = await pickCityAndCategory();
    const images1 = await createImagePair(owner.id);
    const blocked = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: `含${keyword}的標題`,
        description: "應該被新詞條攔截",
        categoryId,
        cityId,
        images: [images1],
      },
    });
    expect(blocked.status).toBe(422);

    const deactivate = await api(`/api/admin/keyword-blocklist/${id}`, {
      method: "PATCH",
      user: mod,
      body: { isActive: false },
    });
    expect(deactivate.status).toBe(200);
    expect((deactivate.json as { isActive: boolean }).isActive).toBe(false);

    const auditLog = await db.auditLog.findFirst({
      where: { action: "keyword_blocklist.deactivate", targetId: id },
    });
    expect(auditLog).not.toBeNull();

    const images2 = await createImagePair(owner.id);
    const allowedAfterDeactivate = await api("/api/items", {
      method: "POST",
      user: owner,
      body: {
        title: `含${keyword}的標題二`,
        description: "詞條已停用，不應該被擋",
        categoryId,
        cityId,
        images: [images2],
      },
    });
    expect(allowedAfterDeactivate.status).not.toBe(422);

    const reactivate = await api(`/api/admin/keyword-blocklist/${id}`, {
      method: "PATCH",
      user: mod,
      body: { isActive: true },
    });
    expect(reactivate.status).toBe(200);
    expect((reactivate.json as { isActive: boolean }).isActive).toBe(true);
  });

  it("一般使用者（非 moderator/admin）呼叫 → 403；未登入 → 401", async () => {
    const stranger = await user("kb-crud-stranger");
    const forbidden = await api("/api/admin/keyword-blocklist", {
      method: "POST",
      user: stranger,
      body: { keyword: "不該成功" },
    });
    expect(forbidden.status).toBe(403);

    const unauthorized = await api("/api/admin/keyword-blocklist", {
      method: "POST",
      body: { keyword: "不該成功" },
    });
    expect(unauthorized.status).toBe(401);

    const listForbidden = await api("/api/admin/keyword-blocklist", { user: stranger });
    expect(listForbidden.status).toBe(403);
  });
});
