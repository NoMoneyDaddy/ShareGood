import { afterAll, describe, expect, it } from "vitest";
import { deterministicShuffle } from "@/lib/lottery";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { createPublishedItem } from "../support/items";

// master-plan §5a 驗收清單：M5 抽籤（開抽籤／報名／取消／開獎／確認／婉拒遞補／候補用盡／
// 取消抽籤／留言直贈互斥／稽核紀錄可重演）。
//
// 對應實作：
//   src/app/api/items/[id]/lottery/route.ts（建立/查詢）
//   src/app/api/items/[id]/lottery/entries/route.ts（報名/取消報名）
//   src/app/api/lotteries/[id]/{cancel,confirm,decline}/route.ts
//   src/app/api/jobs/lottery-draw/route.ts（開獎與逾時遞補 job）
//   src/lib/lottery.ts（決定性洗牌、開獎、遞補的共用邏輯）
const CRON_SECRET = process.env.CRON_SECRET;

async function callDrawJob(secret: string | undefined = CRON_SECRET) {
  const res = await fetch(`${BASE_URL}/api/jobs/lottery-draw`, {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as { drawnCount: number; advancedCount: number } | null };
}

function futureIso(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

async function createLottery(owner: TestUser, itemId: string, entryDeadline: string) {
  const res = await api(`/api/items/${itemId}/lottery`, {
    method: "POST",
    user: owner,
    body: { entryDeadline },
  });
  if (res.status !== 201) {
    throw new Error(`建立測試抽籤失敗：${res.status} ${JSON.stringify(res.json)}`);
  }
  return (res.json as { id: string }).id;
}

async function enter(user: TestUser, itemId: string) {
  return api(`/api/items/${itemId}/lottery/entries`, { method: "POST", user });
}

describe("M5 抽籤：建立與跟留言/直贈互斥", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("物主開抽籤後 items.status 仍是 published；非物主不能開抽籤", async () => {
    const owner = await createTestUser({ label: "lottery-create-owner" });
    const other = await createTestUser({ label: "lottery-create-other" });
    userIds.push(owner.id, other.id);
    const itemId = await createPublishedItem(owner);

    const forbidden = await api(`/api/items/${itemId}/lottery`, {
      method: "POST",
      user: other,
      body: { entryDeadline: futureIso(60 * 60 * 1000) },
    });
    expect(forbidden.status).toBe(403);

    const created = await api(`/api/items/${itemId}/lottery`, {
      method: "POST",
      user: owner,
      body: { entryDeadline: futureIso(60 * 60 * 1000) },
    });
    expect(created.status).toBe(201);

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const status = await api(`/api/items/${itemId}/lottery`, { method: "GET" });
    expect(status.status).toBe(200);
    expect((status.json as { status: string }).status).toBe("open");
  });

  it("一物品終身只能抽籤一次：已有抽籤時再建立回 409", async () => {
    const owner = await createTestUser({ label: "lottery-once-owner" });
    userIds.push(owner.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));

    const again = await api(`/api/items/${itemId}/lottery`, {
      method: "POST",
      user: owner,
      body: { entryDeadline: futureIso(2 * 60 * 60 * 1000) },
    });
    expect(again.status).toBe(409);
  });

  it("非終態抽籤存在時，留言與直贈都回 409；流標之後兩者恢復成功", async () => {
    const owner = await createTestUser({ label: "lottery-conflict-owner" });
    const claimer = await createTestUser({ label: "lottery-conflict-claimer" });
    const giftee = await createTestUser({ label: "lottery-conflict-giftee" });
    userIds.push(owner.id, claimer.id, giftee.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));

    const claimRes = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "我想要這個" },
    });
    expect(claimRes.status).toBe(409);

    const shareRes = await api(`/api/items/${itemId}/direct-shares`, {
      method: "POST",
      user: owner,
      body: { receiverEmail: giftee.email },
    });
    expect(shareRes.status).toBe(409);

    // 截止時間撥到過去、觸發 job → 零報名應該直接流標（failed_no_entries）。
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    expect(CRON_SECRET).toBeTruthy();
    const run = await callDrawJob();
    expect(run.status).toBe(200);

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    expect(lottery.status).toBe("failed_no_entries");

    const claimAfter = await api(`/api/items/${itemId}/claims`, {
      method: "POST",
      user: claimer,
      body: { message: "現在可以了嗎" },
    });
    expect(claimAfter.status).toBe(201);
  });
});

describe("M5 抽籤：報名併發保護", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("同一使用者兩個請求同時報名 → 恰好一筆 entry 成功，另一筆回 409", async () => {
    const owner = await createTestUser({ label: "lottery-race-owner" });
    const entrant = await createTestUser({ label: "lottery-race-entrant" });
    userIds.push(owner.id, entrant.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));

    const [a, b] = await Promise.all([enter(entrant, itemId), enter(entrant, itemId)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    const entries = await db.lotteryEntry.findMany({
      where: { lotteryId: lottery.id, userId: entrant.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("entered");
  });

  it("物主不能報名自己的抽籤；重複報名回 409；取消後可以重新報名", async () => {
    const owner = await createTestUser({ label: "lottery-selfcheck-owner" });
    const entrant = await createTestUser({ label: "lottery-selfcheck-entrant" });
    userIds.push(owner.id, entrant.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));

    const ownerEnter = await enter(owner, itemId);
    expect(ownerEnter.status).toBe(409);

    const first = await enter(entrant, itemId);
    expect(first.status).toBe(201);
    const dup = await enter(entrant, itemId);
    expect(dup.status).toBe(409);

    const cancel = await api(`/api/items/${itemId}/lottery/entries`, {
      method: "DELETE",
      user: entrant,
    });
    expect(cancel.status).toBe(200);

    const reEnter = await enter(entrant, itemId);
    expect(reEnter.status).toBe(201);

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    const entries = await db.lotteryEntry.findMany({
      where: { lotteryId: lottery.id, userId: entrant.id },
    });
    // 取消再報名是同一列從 cancelled 改回 entered，不是新增一列。
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("entered");
  });
});

describe("M5 抽籤：開獎併發保護與重演驗證", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("兩個請求同時觸發開獎 job → 只有一次真正執行開獎", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-drawrace-owner" });
    const entrants = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createTestUser({ label: `lottery-drawrace-${i}` })),
    );
    userIds.push(owner.id, ...entrants.map((e) => e.id));
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    for (const entrant of entrants) {
      const res = await enter(entrant, itemId);
      expect(res.status).toBe(201);
    }

    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });

    const [runA, runB] = await Promise.all([callDrawJob(), callDrawJob()]);
    expect(runA.status).toBe(200);
    expect(runB.status).toBe(200);

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    expect(lottery.status).toBe("awaiting_confirmation");
    expect(lottery.seed).toBeTruthy();

    const results = await db.lotteryResult.findMany({ where: { lotteryId: lottery.id } });
    // 5 位報名者，開獎恰好只執行一次 → 恰好 5 筆 result（若重複開獎會撞 unique 或產生 10 筆）。
    expect(results).toHaveLength(5);

    const drawStartedLogs = await db.lotteryAuditLog.findMany({
      where: { lotteryId: lottery.id, action: "draw_started" },
    });
    expect(drawStartedLogs).toHaveLength(1);
    const drawCompletedLogs = await db.lotteryAuditLog.findMany({
      where: { lotteryId: lottery.id, action: "draw_completed" },
    });
    expect(drawCompletedLogs).toHaveLength(1);
  });

  it("開獎結果可用 (seed, entrySnapshot, algoVersion) 重演驗證", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-replay-owner" });
    const entrants = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createTestUser({ label: `lottery-replay-${i}` })),
    );
    userIds.push(owner.id, ...entrants.map((e) => e.id));
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    for (const entrant of entrants) {
      expect((await enter(entrant, itemId)).status).toBe(201);
    }
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    expect(lottery.algoVersion).toBe("hmac-sha256-fisher-yates-v1");
    const snapshot = lottery.entrySnapshot as string[];
    expect(snapshot).toHaveLength(6);

    const replayed = deterministicShuffle(snapshot, lottery.seed as string);

    const results = await db.lotteryResult.findMany({
      where: { lotteryId: lottery.id },
      orderBy: { rank: "asc" },
    });
    expect(results.map((r) => r.entryId)).toEqual(replayed);
  });
});

describe("M5 抽籤：逾時遞補、婉拒遞補、候補用盡", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("rank 1 逾時未確認 → job 轉 expired 並遞補 rank 2，confirm_deadline 重新起算 48 小時", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-expire-owner" });
    const a = await createTestUser({ label: "lottery-expire-a" });
    const b = await createTestUser({ label: "lottery-expire-b" });
    userIds.push(owner.id, a.id, b.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    expect((await enter(b, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery1 = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    expect(lottery1.currentRank).toBe(1);

    // 把 rank 1 的 confirm_deadline 撥到過去，模擬「逾時未回應」。
    await db.lotteryResult.updateMany({
      where: { lotteryId: lottery1.id, rank: 1 },
      data: { confirmDeadline: new Date(Date.now() - 1000) },
    });

    const beforeAdvance = Date.now();
    const run = await callDrawJob();
    expect(run.status).toBe(200);
    expect(run.json?.advancedCount).toBeGreaterThanOrEqual(1);

    const rank1 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery1.id, rank: 1 },
    });
    expect(rank1.status).toBe("expired");

    const rank2 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery1.id, rank: 2 },
    });
    expect(rank2.status).toBe("offered");
    expect(rank2.confirmDeadline).not.toBeNull();
    // 新的 confirm_deadline 是從遞補當下重新起算的 48 小時，不是沿用原本的舊時間戳。
    const deadlineMs = rank2.confirmDeadline?.getTime() ?? 0;
    expect(deadlineMs).toBeGreaterThan(beforeAdvance + 47 * 60 * 60 * 1000);

    const lottery2 = await db.lottery.findUniqueOrThrow({ where: { id: lottery1.id } });
    expect(lottery2.currentRank).toBe(2);
    expect(lottery2.status).toBe("awaiting_confirmation");

    const rank2UserIsB = rank2.userId === b.id || rank2.userId === a.id;
    expect(rank2UserIsB).toBe(true);
  });

  it("候選人主動婉拒 → 立即遞補（不必等 job），audit log 有 rank_declined 與 rank_offered", async () => {
    const owner = await createTestUser({ label: "lottery-decline-owner" });
    const a = await createTestUser({ label: "lottery-decline-a" });
    const b = await createTestUser({ label: "lottery-decline-b" });
    userIds.push(owner.id, a.id, b.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    expect((await enter(b, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    const rank1 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 1 },
    });
    const winner = rank1.userId === a.id ? a : b;
    const loser = rank1.userId === a.id ? b : a;

    // 非中選者不能婉拒。
    const forbidden = await api(`/api/lotteries/${lottery.id}/decline`, {
      method: "PATCH",
      user: loser,
    });
    expect(forbidden.status).toBe(403);

    const decline = await api(`/api/lotteries/${lottery.id}/decline`, {
      method: "PATCH",
      user: winner,
    });
    expect(decline.status).toBe(200);

    const rank1After = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 1 },
    });
    expect(rank1After.status).toBe("declined");
    const rank2After = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 2 },
    });
    expect(rank2After.status).toBe("offered");
    expect(rank2After.userId).toBe(loser.id);

    const declinedLogs = await db.lotteryAuditLog.findMany({
      where: { lotteryId: lottery.id, action: "rank_declined" },
    });
    expect(declinedLogs).toHaveLength(1);
    const offeredLogs = await db.lotteryAuditLog.findMany({
      where: { lotteryId: lottery.id, action: "rank_offered" },
    });
    expect(offeredLogs).toHaveLength(2); // rank 1 開獎時一筆、遞補到 rank 2 一筆

    // 已經處理過的名額不能再婉拒第二次。
    const again = await api(`/api/lotteries/${lottery.id}/decline`, {
      method: "PATCH",
      user: winner,
    });
    expect(again.status).toBe(403);
  });

  it("所有候補都用盡 → failed_no_entries；items.status 維持 published；物主收到流標通知", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-exhaust-owner" });
    const a = await createTestUser({ label: "lottery-exhaust-a" });
    const b = await createTestUser({ label: "lottery-exhaust-b" });
    userIds.push(owner.id, a.id, b.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    expect((await enter(b, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });

    // rank 1 婉拒 → 遞補 rank 2。
    const rank1 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 1 },
    });
    const rank1User = rank1.userId === a.id ? a : b;
    const decline1 = await api(`/api/lotteries/${lottery.id}/decline`, {
      method: "PATCH",
      user: rank1User,
    });
    expect(decline1.status).toBe(200);
    expect((decline1.json as { outcome: string }).outcome).toBe("advanced");

    // rank 2（僅剩的候補）也婉拒 → 候補用盡，流標。
    const rank2 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 2 },
    });
    const rank2User = rank2.userId === a.id ? a : b;
    const decline2 = await api(`/api/lotteries/${lottery.id}/decline`, {
      method: "PATCH",
      user: rank2User,
    });
    expect(decline2.status).toBe(200);
    expect((decline2.json as { outcome: string }).outcome).toBe("failed_no_entries");

    const lotteryAfter = await db.lottery.findUniqueOrThrow({ where: { id: lottery.id } });
    expect(lotteryAfter.status).toBe("failed_no_entries");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const ownerNotifications = await db.notification.findMany({ where: { userId: owner.id } });
    const failedNotice = ownerNotifications.find(
      (n) => (n.payload as { kind?: string }).kind === "lottery_failed",
    );
    expect(failedNotice).toBeTruthy();
  });
});

describe("M5 抽籤：確認、貢獻值、既有交接流程銜接", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("得主確認 → lottery completed、item reserved，無痛接續既有交接流程直到完成；貢獻值只記給物主與中選者", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-confirm-owner" });
    const a = await createTestUser({ label: "lottery-confirm-a" });
    const b = await createTestUser({ label: "lottery-confirm-b" });
    userIds.push(owner.id, a.id, b.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    expect((await enter(b, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    const rank1 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 1 },
    });
    const winner = rank1.userId === a.id ? a : b;
    const loser = rank1.userId === a.id ? b : a;

    // 非中選者不能確認。
    const forbidden = await api(`/api/lotteries/${lottery.id}/confirm`, {
      method: "PATCH",
      user: loser,
    });
    expect(forbidden.status).toBe(403);

    const confirm = await api(`/api/lotteries/${lottery.id}/confirm`, {
      method: "PATCH",
      user: winner,
    });
    expect(confirm.status).toBe(200);
    expect((confirm.json as { status: string }).status).toBe("completed");

    const lotteryAfter = await db.lottery.findUniqueOrThrow({ where: { id: lottery.id } });
    expect(lotteryAfter.status).toBe("completed");
    const itemAfter = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(itemAfter.status).toBe("reserved");

    // 重複確認回 409（名額已被處理過）。
    const dup = await api(`/api/lotteries/${lottery.id}/confirm`, {
      method: "PATCH",
      user: winner,
    });
    expect(dup.status).toBe(409);

    // 無痛接續既有 M1 交接流程：handover/ensure 應該能認出 winner 就是接手者。
    const ensure = await api(`/api/items/${itemId}/handover/ensure`, {
      method: "POST",
      user: owner,
    });
    expect(ensure.status).toBe(200);
    const handover = await db.handoverRecord.findUniqueOrThrow({ where: { itemId } });
    expect(handover.receiverId).toBe(winner.id);

    const ownerComplete = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: owner,
    });
    expect(ownerComplete.status).toBe(200);
    const receiverComplete = await api(`/api/handover/${handover.id}/complete`, {
      method: "PATCH",
      user: winner,
    });
    expect(receiverComplete.status).toBe(200);
    expect((receiverComplete.json as { status: string }).status).toBe("completed");

    const itemFinal = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(itemFinal.status).toBe("completed");

    // 貢獻值：只有物主（分享完成 +10）與中選者（接手完成 +2）各一筆，
    // 沒中籤的 loser 完全不產生 contribution_events。
    const contributionEvents = await db.contributionEvent.findMany({ where: { itemId } });
    expect(contributionEvents).toHaveLength(2);
    const loserEvents = contributionEvents.filter((c) => c.userId === loser.id);
    expect(loserEvents).toHaveLength(0);
  });

  it("確認時間已過期 → confirm 回 409（改由 job 遞補）", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-expiredconfirm-owner" });
    const a = await createTestUser({ label: "lottery-expiredconfirm-a" });
    userIds.push(owner.id, a.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    await db.lotteryResult.updateMany({
      where: { lotteryId: lottery.id, rank: 1 },
      data: { confirmDeadline: new Date(Date.now() - 1000) },
    });

    const res = await api(`/api/lotteries/${lottery.id}/confirm`, { method: "PATCH", user: a });
    expect(res.status).toBe(409);
  });
});

describe("M5 抽籤：取消抽籤", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("非物主 403；status≠open 時 409；open 時取消成功並通知所有報名者", async () => {
    const owner = await createTestUser({ label: "lottery-cancel-owner" });
    const other = await createTestUser({ label: "lottery-cancel-other" });
    const entrant = await createTestUser({ label: "lottery-cancel-entrant" });
    userIds.push(owner.id, other.id, entrant.id);
    const itemId = await createPublishedItem(owner);
    const lotteryId = await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(entrant, itemId)).status).toBe(201);

    const forbidden = await api(`/api/lotteries/${lotteryId}/cancel`, {
      method: "PATCH",
      user: other,
    });
    expect(forbidden.status).toBe(403);

    const cancelled = await api(`/api/lotteries/${lotteryId}/cancel`, {
      method: "PATCH",
      user: owner,
    });
    expect(cancelled.status).toBe(200);

    const lottery = await db.lottery.findUniqueOrThrow({ where: { id: lotteryId } });
    expect(lottery.status).toBe("cancelled");

    const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("published");

    const notifications = await db.notification.findMany({ where: { userId: entrant.id } });
    const cancelNotice = notifications.find(
      (n) => (n.payload as { kind?: string }).kind === "lottery_cancelled",
    );
    expect(cancelNotice).toBeTruthy();

    // 已經 cancelled，再取消一次回 409；且該物品永遠無法重新開抽籤。
    const again = await api(`/api/lotteries/${lotteryId}/cancel`, { method: "PATCH", user: owner });
    expect(again.status).toBe(409);

    const recreate = await api(`/api/items/${itemId}/lottery`, {
      method: "POST",
      user: owner,
      body: { entryDeadline: futureIso(60 * 60 * 1000) },
    });
    expect(recreate.status).toBe(409);
  });

  it("已開獎後不可取消", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-cancelafterdraw-owner" });
    const a = await createTestUser({ label: "lottery-cancelafterdraw-a" });
    userIds.push(owner.id, a.id);
    const itemId = await createPublishedItem(owner);
    const lotteryId = await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const res = await api(`/api/lotteries/${lotteryId}/cancel`, { method: "PATCH", user: owner });
    expect(res.status).toBe(409);
  });
});

describe("M5 抽籤：稽核紀錄可重演出完整時間序", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  it("報名→開獎→逾時→遞補→確認 全流程的 audit log 依 created_at 排序可還原完整事件序", async () => {
    expect(CRON_SECRET).toBeTruthy();
    const owner = await createTestUser({ label: "lottery-audit-owner" });
    const a = await createTestUser({ label: "lottery-audit-a" });
    const b = await createTestUser({ label: "lottery-audit-b" });
    userIds.push(owner.id, a.id, b.id);
    const itemId = await createPublishedItem(owner);
    await createLottery(owner, itemId, futureIso(60 * 60 * 1000));
    expect((await enter(a, itemId)).status).toBe(201);
    expect((await enter(b, itemId)).status).toBe(201);
    await db.lottery.update({
      where: { itemId },
      data: { entryDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const lottery = await db.lottery.findUniqueOrThrow({ where: { itemId } });
    const rank1 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 1 },
    });
    await db.lotteryResult.updateMany({
      where: { id: rank1.id },
      data: { confirmDeadline: new Date(Date.now() - 1000) },
    });
    await callDrawJob();

    const rank2 = await db.lotteryResult.findFirstOrThrow({
      where: { lotteryId: lottery.id, rank: 2 },
    });
    const winner = rank2.userId === a.id ? a : b;
    const confirmRes = await api(`/api/lotteries/${lottery.id}/confirm`, {
      method: "PATCH",
      user: winner,
    });
    expect(confirmRes.status).toBe(200);

    const logs = await db.lotteryAuditLog.findMany({
      where: { lotteryId: lottery.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const actions = logs.map((l) => l.action);

    expect(actions.filter((a) => a === "entry_created")).toHaveLength(2);
    expect(actions).toContain("draw_started");
    expect(actions).toContain("draw_completed");
    expect(actions).toContain("rank_expired");
    expect(actions).toContain("rank_confirmed");
    expect(actions).toContain("item_reserved");
    // rank_offered 出現兩次：開獎當下給 rank1、逾時遞補時給 rank2。
    expect(actions.filter((a) => a === "rank_offered")).toHaveLength(2);

    // 時間序：entry_created 兩筆一定在 draw_started 之前；rank_expired 在 rank_confirmed 之前。
    const idxDrawStarted = actions.indexOf("draw_started");
    const idxRankExpired = actions.indexOf("rank_expired");
    const idxRankConfirmed = actions.indexOf("rank_confirmed");
    const entryIdxs = actions.reduce<number[]>((acc, a, i) => {
      if (a === "entry_created") acc.push(i);
      return acc;
    }, []);
    expect(Math.max(...entryIdxs)).toBeLessThan(idxDrawStarted);
    expect(idxRankExpired).toBeLessThan(idxRankConfirmed);
  });
});
