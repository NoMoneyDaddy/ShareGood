import { afterAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { pickCityAndCategory } from "../support/items";

// master-plan §8 驗收清單：「錢包頁正確分列已分享/已接手」。
//
// 這裡不透過 POST /api/items 建立優惠券物品——該端點的優惠券子表單支援屬於平行進行的
// feat/m3-coupon-encryption，尚未 merge——而是直接用 Prisma 建對應資料列。錢包頁本身
// 也只是讀資料庫狀態（見 src/app/me/wallet/page.tsx 的 fetchSharedCoupons／
// fetchReceivedCoupons），跟上架 API 的實作細節無關，兩邊互不阻塞。
//
// 頁面是 Server Component（無專屬 JSON API），驗證方式比照 e2e/integration/seo.test.ts：
// 直接 fetch HTML、對關鍵文字（物品標題、狀態徽章、揭露狀態字樣）做字串斷言。
describe("優惠券錢包 /me/wallet", () => {
  const userIds: string[] = [];
  const suffix = Date.now();

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label: `${label}-${suffix}` });
    userIds.push(u.id);
    return u;
  }

  async function createCouponItem(opts: {
    ownerId: string;
    title: string;
    status: "draft" | "published" | "reserved" | "handover_pending" | "completed" | "expired";
    cityId: string;
    categoryId: string;
  }) {
    return db.item.create({
      data: {
        ownerId: opts.ownerId,
        title: opts.title,
        description: "整合測試用的假物品描述內容",
        categoryId: opts.categoryId,
        cityId: opts.cityId,
        status: opts.status,
        publishedAt: opts.status === "draft" ? null : new Date(),
        expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000),
        couponDetail: { create: { faceValue: "$100 折價", merchantName: "測試店家" } },
      },
    });
  }

  it("正確分列「我分享的券」與「我接手的券」，排除 draft，且互不外洩", async () => {
    const owner = await user("wallet-owner-a");
    const receiver = await user("wallet-receiver-a");
    const otherClaimer = await user("wallet-other-claimer-a");
    const { cityId, categoryId } = await pickCityAndCategory();

    const publishedTitle = `[wallet測試-${suffix}]進行中券`;
    const draftTitle = `[wallet測試-${suffix}]草稿券`;
    await createCouponItem({
      ownerId: owner.id,
      title: publishedTitle,
      status: "published",
      cityId,
      categoryId,
    });
    await createCouponItem({
      ownerId: owner.id,
      title: draftTitle,
      status: "draft",
      cityId,
      categoryId,
    });

    // handover_pending：receiver 透過 HandoverRecord 為權威接手者來源。
    const handoverTitle = `[wallet測試-${suffix}]交接中券`;
    const handoverItem = await createCouponItem({
      ownerId: owner.id,
      title: handoverTitle,
      status: "handover_pending",
      cityId,
      categoryId,
    });
    await db.handoverRecord.create({
      data: { itemId: handoverItem.id, receiverId: receiver.id, status: "pending" },
    });

    // reserved：接手者資訊還只存在 accepted ClaimComment（懶建立模式，尚無 HandoverRecord）。
    const reservedTitle = `[wallet測試-${suffix}]已被認領券`;
    const reservedItem = await createCouponItem({
      ownerId: owner.id,
      title: reservedTitle,
      status: "reserved",
      cityId,
      categoryId,
    });
    await db.claimComment.create({
      data: { itemId: reservedItem.id, userId: receiver.id, message: "我要！", status: "accepted" },
    });
    await db.claimComment.create({
      data: {
        itemId: reservedItem.id,
        userId: otherClaimer.id,
        message: "我也想要",
        status: "declined",
      },
    });

    const ownerRes = await api("/me/wallet", { user: owner });
    expect(ownerRes.status).toBe(200);
    const ownerHtml = ownerRes.json as unknown as string;
    expect(ownerHtml).toContain(publishedTitle);
    expect(ownerHtml).toContain(handoverTitle);
    expect(ownerHtml).toContain(reservedTitle);
    expect(ownerHtml).not.toContain(draftTitle); // draft 不是「還活著」的優惠券狀態

    const receiverRes = await api("/me/wallet", { user: receiver });
    expect(receiverRes.status).toBe(200);
    const receiverHtml = receiverRes.json as unknown as string;
    expect(receiverHtml).toContain(handoverTitle); // HandoverRecord 來源
    expect(receiverHtml).toContain(reservedTitle); // accepted ClaimComment 來源
    expect(receiverHtml).not.toContain(publishedTitle); // 還沒人認領，不算「我接手的」

    const otherClaimerRes = await api("/me/wallet", { user: otherClaimer });
    expect(otherClaimerRes.status).toBe(200);
    const otherClaimerHtml = otherClaimerRes.json as unknown as string;
    expect(otherClaimerHtml).not.toContain(reservedTitle); // declined 的人看不到
  });

  it("我接手的券正確顯示揭露狀態：已查看過 vs 尚未查看", async () => {
    const owner = await user("wallet-owner-reveal");
    const receiver = await user("wallet-receiver-reveal");
    const { cityId, categoryId } = await pickCityAndCategory();

    async function createHandoverCouponWithSecret(title: string) {
      const item = await createCouponItem({
        ownerId: owner.id,
        title,
        status: "handover_pending",
        cityId,
        categoryId,
      });
      await db.handoverRecord.create({
        data: { itemId: item.id, receiverId: receiver.id, status: "pending" },
      });
      const couponDetail = await db.couponDetail.findUniqueOrThrow({ where: { itemId: item.id } });
      const secret = await db.couponSecret.create({
        data: { couponDetailId: couponDetail.id, ciphertext: "cipher", iv: "iv", authTag: "tag" },
      });
      return secret;
    }

    const revealedTitle = `[wallet測試-${suffix}]已查看券`;
    const revealedSecret = await createHandoverCouponWithSecret(revealedTitle);
    await db.couponRevealLog.create({
      data: { couponSecretId: revealedSecret.id, revealedBy: receiver.id },
    });

    const notRevealedTitle = `[wallet測試-${suffix}]尚未查看券`;
    await createHandoverCouponWithSecret(notRevealedTitle);

    const res = await api("/me/wallet", { user: receiver });
    expect(res.status).toBe(200);
    const html = res.json as unknown as string;

    function chunkAfter(title: string) {
      const idx = html.indexOf(title);
      expect(idx).toBeGreaterThan(-1);
      return html.slice(idx, idx + 600);
    }

    expect(chunkAfter(revealedTitle)).toContain("券碼已查看過");
    expect(chunkAfter(notRevealedTitle)).toContain("券碼尚未查看");
  });

  it("分頁：一頁最多 20 筆，下一頁接續不重複", async () => {
    const owner = await user("wallet-owner-page");
    const { cityId, categoryId } = await pickCityAndCategory();

    const titles: string[] = [];
    for (let i = 0; i < 25; i++) {
      const title = `[wallet分頁測試-${suffix}]#${String(i).padStart(2, "0")}`;
      titles.push(title);
      await createCouponItem({ ownerId: owner.id, title, status: "published", cityId, categoryId });
    }

    const page1 = await api("/me/wallet", { user: owner });
    expect(page1.status).toBe(200);
    const html1 = page1.json as unknown as string;
    const countOnPage1 = titles.filter((t) => html1.includes(t)).length;
    expect(countOnPage1).toBe(20);
    expect(html1).toContain("下一頁");

    const cursorMatch = html1.match(/sharedCursor=([a-zA-Z0-9]+)/);
    expect(cursorMatch).not.toBeNull();
    const cursor = cursorMatch?.[1];

    const page2 = await api(`/me/wallet?sharedCursor=${cursor}`, { user: owner });
    expect(page2.status).toBe(200);
    const html2 = page2.json as unknown as string;
    const countOnPage2 = titles.filter((t) => html2.includes(t)).length;
    expect(countOnPage2).toBe(5);

    // 兩頁不重複。
    const overlap = titles.filter((t) => html1.includes(t) && html2.includes(t));
    expect(overlap).toHaveLength(0);
  });

  it("未登入呼叫 /me/wallet → 導回首頁", async () => {
    const res = await fetch(`${BASE_URL}/me/wallet`, { redirect: "manual" });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location") ?? "";
    expect(location.endsWith("/") || location === "").toBe(true);
  });
});
