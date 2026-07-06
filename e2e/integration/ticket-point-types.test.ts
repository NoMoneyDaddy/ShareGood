import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { attemptCreateItem, createPublishedItem } from "../support/items";

// master-plan.md §9a 交付內容 4／5／6 驗收清單：票券/點數類型 slug 驗證邊界、
// 加價/折現/不可上架清單關鍵字攔截、點數個資最小化（固定詞＋手機號正則）、
// detail 表寫入正確（無金額欄位）、留言/私訊手機號攔截只套用點數類物品。
//
// 對應實作：
//   src/app/api/items/route.ts（POST 驗證與 ticket_details/point_details 寫入）
//   src/lib/ticket-guard.ts（不可上架清單攔截層一）
//   src/lib/phone-guard.ts（台灣手機號正則）
//   src/app/api/items/[id]/claims/route.ts、src/app/api/conversations/[id]/messages/route.ts
//   src/app/items/[id]/ticket-section.tsx、point-section.tsx（詳情頁文案）
describe("M9 票券類型", () => {
  const userIds: string[] = [];
  let ticketCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "tickets" } });
    ticketCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("缺券種／原平台 → 422", async () => {
    const owner = await user("ticket-missing-owner");
    const res = await attemptCreateItem(owner, {
      categoryId: ticketCategoryId,
      ticket: { ticketType: "", originPlatform: "" },
    });
    expect(res.status).toBe(422);
  });

  it("券種／描述含加價關鍵字（+300/私訊出價）→ 422", async () => {
    const owner = await user("ticket-markup-owner");
    const res = await attemptCreateItem(owner, {
      categoryId: ticketCategoryId,
      ticket: { ticketType: "序號券 +300", originPlatform: "主辦官網" },
    });
    expect(res.status).toBe(422);

    const res2 = await attemptCreateItem(owner, {
      categoryId: ticketCategoryId,
      description: "私訊出價喔",
      ticket: { ticketType: "序號券", originPlatform: "主辦官網" },
    });
    expect(res2.status).toBe(422);
  });

  it("不可上架清單：標題或券種含「LINE 即享券」「隨買跨店取」等變體 → 422", async () => {
    const owner = await user("ticket-non-transferable-owner");

    const byTitle = await attemptCreateItem(owner, {
      categoryId: ticketCategoryId,
      title: "轉讓 LINE即享券 一張",
      ticket: { ticketType: "電子券", originPlatform: "LINE" },
    });
    expect(byTitle.status).toBe(422);

    const byTicketType = await attemptCreateItem(owner, {
      categoryId: ticketCategoryId,
      ticket: { ticketType: "7-11隨買跨店取", originPlatform: "7-ELEVEN" },
    });
    expect(byTicketType.status).toBe(422);
  });

  it("正常建立：ticket_details 正確寫入且無金額/自己的效期欄位；詳情頁顯示法定警示", async () => {
    const owner = await user("ticket-ok-owner");
    const itemId = await createPublishedItem(owner, {
      categoryId: ticketCategoryId,
      ticket: {
        ticketType: "紙本入場券",
        originPlatform: "KKTIX",
        eventName: "2026 夏季音樂節",
      },
    });

    const detail = await db.ticketDetail.findUniqueOrThrow({ where: { itemId } });
    expect(detail.ticketType).toBe("紙本入場券");
    expect(detail.originPlatform).toBe("KKTIX");
    expect(detail.eventName).toBe("2026 夏季音樂節");
    // 明確無金額欄位、無自己的效期欄位：detail row 只有這幾個欄位（id/itemId/建立更新時間之外）。
    expect(Object.keys(detail).sort()).toEqual(
      [
        "id",
        "itemId",
        "ticketType",
        "originPlatform",
        "eventName",
        "createdAt",
        "updatedAt",
      ].sort(),
    );

    const page = await fetch(`${BASE_URL}/items/${itemId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("文創法第 10 條之 1");
    expect(html).toContain("走官方流程完成轉讓");
    expect(html).not.toContain("保證可兌換");
  });
});

describe("M9 點數類型", () => {
  const userIds: string[] = [];
  let pointCategoryId: string;

  beforeAll(async () => {
    const category = await db.category.findFirstOrThrow({ where: { slug: "points" } });
    pointCategoryId = category.id;
  });

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("缺點數平台／數量非正整數 → 422", async () => {
    const owner = await user("point-missing-owner");
    const missingPlatform = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "", pointAmount: 100 },
    });
    expect(missingPlatform.status).toBe(422);

    const badAmount = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "FamiPoint", pointAmount: 0 },
    });
    expect(badAmount.status).toBe(422);

    const negativeAmount = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "FamiPoint", pointAmount: -5 },
    });
    expect(negativeAmount.status).toBe(422);
  });

  it("點數平台含個資固定詞（驗證碼/會員帳號）→ 422", async () => {
    const owner = await user("point-pii-owner");
    const res = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "FamiPoint 驗證碼共享", pointAmount: 100 },
    });
    expect(res.status).toBe(422);
  });

  it("標題/描述/點數平台含台灣手機號（含全形/分隔符變體）→ 422", async () => {
    const owner = await user("point-phone-owner");

    const inTitle = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      title: "點數贈送 0912-345-678 聯絡",
      point: { pointPlatform: "OPEN POINT", pointAmount: 50 },
    });
    expect(inTitle.status).toBe(422);

    const inDescription = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      description: "有需要私訊０９１２３４５６７８",
      point: { pointPlatform: "OPEN POINT", pointAmount: 50 },
    });
    expect(inDescription.status).toBe(422);
  });

  it("含折現/換現金/交換字眼 → 422", async () => {
    const owner = await user("point-cashout-owner");
    const res = await attemptCreateItem(owner, {
      categoryId: pointCategoryId,
      description: "可換現金喔",
      point: { pointPlatform: "OPEN POINT", pointAmount: 50 },
    });
    expect(res.status).toBe(422);
  });

  it("正常建立：point_details 正確寫入且無金額欄位；詳情頁顯示官方為準警示", async () => {
    const owner = await user("point-ok-owner");
    const itemId = await createPublishedItem(owner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "FamiPoint", pointAmount: 300 },
    });

    const detail = await db.pointDetail.findUniqueOrThrow({ where: { itemId } });
    expect(detail.pointPlatform).toBe("FamiPoint");
    expect(detail.pointAmount).toBe(300);
    expect(Object.keys(detail).sort()).toEqual(
      ["id", "itemId", "pointPlatform", "pointAmount", "createdAt", "updatedAt"].sort(),
    );

    const page = await fetch(`${BASE_URL}/items/${itemId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("以官方 App");
    expect(html).toContain("本平台不經手點數");
  });

  it("留言含手機號：點數類物品 → 422；非點數類物品 → 不受影響", async () => {
    const pointOwner = await user("point-claim-owner");
    const otherOwner = await user("point-claim-other-owner");
    const claimer = await user("point-claim-claimer");

    const pointItemId = await createPublishedItem(pointOwner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "OPEN POINT", pointAmount: 100 },
    });
    const blockedClaim = await api(`/api/items/${pointItemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "可以留手機號 0912345678 聯絡我嗎" },
    });
    expect(blockedClaim.status).toBe(422);

    const normalItemId = await createPublishedItem(otherOwner);
    const allowedClaim = await api(`/api/items/${normalItemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "手機 0912345678 方便聯絡" },
    });
    expect(allowedClaim.status).toBe(201);
  });

  it("私訊含手機號：點數類物品交接對話 → 422；非點數類物品不受影響", async () => {
    const pointOwner = await user("point-msg-owner");
    const receiver = await user("point-msg-receiver");

    const pointItemId = await createPublishedItem(pointOwner, {
      categoryId: pointCategoryId,
      point: { pointPlatform: "FamiPoint", pointAmount: 200 },
    });
    const claimRes = await api(`/api/items/${pointItemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要這筆點數" },
    });
    expect(claimRes.status).toBe(201);
    const ensureRes = await api(`/api/items/${pointItemId}/handover/ensure`, {
      method: "POST",
      user: receiver,
    });
    expect(ensureRes.status).toBe(200);
    const conversationId = (ensureRes.json as { conversationId: string }).conversationId;

    const blockedMessage = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      user: receiver,
      body: { body: "我的手機是 0912-345-678" },
    });
    expect(blockedMessage.status).toBe(422);

    // 非點數類物品的交接對話：手機號不受這條規則影響（沿用一般留言/私訊規則）。
    const otherOwner = await user("point-msg-other-owner");
    const otherReceiver = await user("point-msg-other-receiver");
    const otherItemId = await createPublishedItem(otherOwner);
    const otherClaimRes = await api(`/api/items/${otherItemId}/claims`, {
      method: "POST",
      user: otherReceiver,
      body: { message: "我想要" },
    });
    expect(otherClaimRes.status).toBe(201);
    const otherEnsureRes = await api(`/api/items/${otherItemId}/handover/ensure`, {
      method: "POST",
      user: otherReceiver,
    });
    expect(otherEnsureRes.status).toBe(200);
    const otherConversationId = (otherEnsureRes.json as { conversationId: string }).conversationId;
    const allowedMessage = await api(`/api/conversations/${otherConversationId}/messages`, {
      method: "POST",
      user: otherReceiver,
      body: { body: "我的手機是 0912-345-678" },
    });
    expect(allowedMessage.status).toBe(201);
  });
});
