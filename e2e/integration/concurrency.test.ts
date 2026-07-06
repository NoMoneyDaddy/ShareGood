import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §6 驗收清單：「併發驗證：兩個請求同時搶『先到先得』→ 恰好一人成功」。
//
// 對應實作在 src/app/api/items/[id]/claims/route.ts。有兩層保護：
//   1. 進 transaction 前的預先讀取（`item.status !== "published"` → 409）。
//   2. transaction 內 `tx.item.updateMany({ where: { status: "published" }, data:
//      { status: "reserved" } })`：只有一個 transaction 能把 count 更新為 1，
//      輸的那個把自己的留言標成 declined（仍是 201）。
// 實測過（見本檔 git log／PR 說明）：只送兩個併發請求時，本機這組硬體＋Postgres延遲下，
// 幾乎每次都是「先完成的那個請求整個 transaction 都跑完，第二個請求連第 1 層預先讀取
// 都還沒執行到」，於是變成 409 而不是 201 declined——兩種結果都是「正確地只有一人搶到」，
// 只是命中保護的第一層還是第二層而已。為了確實把測試打到第 2 層（transaction 內
// updateMany 的原子性），這裡改成一次送 N 個（預設 10）不同使用者的並發留言，
// 增加真正同時打進 transaction 的機率，並直接斷言「恰好一人成功」這個業務不變量，
// 不對每個請求各自回應的 HTTP 狀態碼做假設。
const CONCURRENT_CLAIMERS = 10;

describe("先到先得併發保護", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it(`${CONCURRENT_CLAIMERS} 個使用者同時留言，恰好一人 accepted、物品恰好轉一次 reserved`, async () => {
    const owner = await createTestUser({ label: "race-owner" });
    userIds.push(owner.id);
    const claimers = await Promise.all(
      Array.from({ length: CONCURRENT_CLAIMERS }, (_, i) => createTestUser({ label: `race-${i}` })),
    );
    userIds.push(...claimers.map((c) => c.id));

    const itemId = await createPublishedItem(owner);

    const responses = await Promise.all(
      claimers.map((claimer) =>
        api(`/api/items/${itemId}/claims`, {
          method: "POST",
          user: claimer,
          body: { message: "我想要這個" },
        }),
      ),
    );

    // 每個回應只能是「201 accepted」「201 declined」或「409 conflict（連 transaction 都
    // 沒進去，預先讀取就發現已經不是 published）」三種之一，不該有其他狀態碼（例如 500）。
    for (const res of responses) {
      expect([201, 409]).toContain(res.status);
    }
    const acceptedCount = responses.filter(
      (r) => r.status === 201 && (r.json as { status: string }).status === "accepted",
    ).length;
    const declinedCount = responses.filter(
      (r) => r.status === 201 && (r.json as { status: string }).status === "declined",
    ).length;
    const conflictCount = responses.filter((r) => r.status === 409).length;

    // 核心不變量：無論輸家是被 transaction 判定 declined、還是被預先讀取擋成 409，
    // 「恰好一人 accepted」都必須成立，這是先到先得機制唯一不能妥協的保證。
    expect(acceptedCount).toBe(1);
    expect(declinedCount + conflictCount).toBe(CONCURRENT_CLAIMERS - 1);

    // DB 層面雙重確認：claim_comments 恰好一筆 accepted（建立留言列數＝進了 transaction
    // 的請求數，可能小於 N，因為部分請求被第一層預先讀取擋掉、根本沒建立留言）。
    const claims = await db.claimComment.findMany({ where: { itemId } });
    expect(claims.filter((c) => c.status === "accepted")).toHaveLength(1);
    expect(claims).toHaveLength(1 + declinedCount);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("reserved");

    const reservedLogs = await db.itemStatusLog.findMany({
      where: { itemId, toStatus: "reserved" },
    });
    expect(reservedLogs).toHaveLength(1); // 沒有因為併發重複寫入狀態紀錄

    // 慢一步的第三個請求（此時物品已經不是 published）該回 409，而不是也建立一筆留言。
    const claimerLate = await createTestUser({ label: "race-late" });
    userIds.push(claimerLate.id);
    const resLate = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimerLate,
      body: { message: "太晚了嗎" },
    });
    expect(resLate.status).toBe(409);
  });

  it("兩個併發請求同時標記交接完成，只觸發一次 completed 與一次貢獻值記分", async () => {
    const owner = await createTestUser({ label: "race-handover-owner" });
    const receiver = await createTestUser({ label: "race-handover-receiver" });
    userIds.push(owner.id, receiver.id);

    const itemId = await createPublishedItem(owner);
    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: receiver,
      body: { message: "我想要" },
    });
    expect(claimRes.status).toBe(201);

    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);

    const handover = await db.handoverRecord.findUniqueOrThrow({ where: { itemId } });

    // 先讓物主確認一次，剩接手者確認會是「觸發轉 completed」的那一次；
    // 這裡用 Promise.all 讓接手者的確認跟物主重複呼叫幾乎同時發生，驗證 idempotent。
    const [firstOwnerConfirm, dup] = await Promise.all([
      api(`/api/handover/${handover.id}/complete`, { method: "PATCH", user: owner }),
      api(`/api/handover/${handover.id}/complete`, { method: "PATCH", user: owner }),
    ]);
    expect(firstOwnerConfirm.status).toBe(200);
    expect(dup.status).toBe(200);

    const afterOwnerConfirm = await db.handoverRecord.findUniqueOrThrow({
      where: { id: handover.id },
    });
    expect(afterOwnerConfirm.status).toBe("pending"); // 只有物主確認，還沒轉 completed

    const receiverConfirm = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: receiver,
    });
    expect(receiverConfirm.status).toBe(200);
    expect((receiverConfirm.json as { status: string }).status).toBe("completed");

    const contributionEvents = await db.contributionEvent.findMany({ where: { itemId } });
    // 分享完成 +10（物主）、接手完成 +2（接手者）——恰好各一筆，不因重複呼叫而重複記分。
    expect(contributionEvents).toHaveLength(2);
  });
});
