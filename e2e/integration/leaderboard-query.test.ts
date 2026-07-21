import { afterAll, describe, expect, it } from "vitest";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// src/app/(shell)/leaderboard/page.tsx 的 getLeaderboard 整支包在 unstable_cache 裡
// （5 分鐘快取），直接 import 測會撞進 production 快取層、也測不到「重新整理後資料
// 有沒有變」。派工說明明講：不要為了測試破壞 production 快取，改用 db 直接驗證同一組
// 查詢條件即可——這裡把 getLeaderboard 內部的三個步驟（groupBy 加總分數→過濾≤0/已去
// 識別化→依分數排序截斷）原樣重現，用 `where: { userId: { in: scopeUserIds } }` 把
// 查詢範圍鎖定在這次測試自己建立的使用者上，避免撞到資料庫裡其他測試殘留的資料，
// 但過濾/排序/截斷的條件本身跟 page.tsx 逐字一致，能驗證同一組邏輯。
const LEADERBOARD_SIZE = 50;

type LeaderboardRow = { userId: string; nickname: string; points: number };

async function runLeaderboardQuery(
  scopeUserIds: string[],
  size: number,
): Promise<LeaderboardRow[]> {
  const grouped = await db.contributionEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: scopeUserIds } },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: size * 4,
  });

  const candidates = grouped
    .map((g) => ({ userId: g.userId, points: g._sum.points ?? 0 }))
    .filter((g) => g.points > 0);
  if (candidates.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: candidates.map((c) => c.userId) }, deletedAt: null },
    include: { profile: { select: { nickname: true } } },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: LeaderboardRow[] = [];
  for (const c of candidates) {
    const user = userById.get(c.userId);
    if (!user?.profile) continue;
    rows.push({ userId: c.userId, nickname: user.profile.nickname, points: c.points });
    if (rows.length >= size) break;
  }
  return rows;
}

describe("排行榜查詢邏輯（重現 getLeaderboard 內部查詢條件）", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  }, 60_000);

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function givePoints(userId: string, points: number) {
    await db.contributionEvent.create({
      data: { userId, type: "share_completed", points },
    });
  }

  it("貢獻值 ≤0 的使用者被排除在榜單之外", async () => {
    const zero = await user("lb-zero");
    const negative = await user("lb-negative");
    const positive = await user("lb-positive");
    await givePoints(zero.id, 0);
    await givePoints(negative.id, -5);
    await givePoints(positive.id, 10);

    const rows = await runLeaderboardQuery([zero.id, negative.id, positive.id], LEADERBOARD_SIZE);
    const ids = rows.map((r) => r.userId);
    expect(ids).toContain(positive.id);
    expect(ids).not.toContain(zero.id);
    expect(ids).not.toContain(negative.id);
  });

  it("已去識別化帳號（deletedAt 非 null）即使貢獻值 >0 也不出現在榜單", async () => {
    const active = await user("lb-active");
    const deleted = await user("lb-deleted");
    await givePoints(active.id, 20);
    await givePoints(deleted.id, 999); // 分數遠高於 active，若沒濾掉會排在最前面

    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const rows = await runLeaderboardQuery([active.id, deleted.id], LEADERBOARD_SIZE);
    const ids = rows.map((r) => r.userId);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(deleted.id);
  });

  it("依貢獻值由高到低排序", async () => {
    const low = await user("lb-order-low");
    const mid = await user("lb-order-mid");
    const high = await user("lb-order-high");
    await givePoints(low.id, 15);
    await givePoints(high.id, 300);
    await givePoints(mid.id, 80);

    const rows = await runLeaderboardQuery([low.id, mid.id, high.id], LEADERBOARD_SIZE);
    expect(rows.map((r) => r.userId)).toEqual([high.id, mid.id, low.id]);
    expect(rows.map((r) => r.points)).toEqual([300, 80, 15]);
  });

  it("截斷到 50 名：55 位候選人只回傳分數最高的前 50 名", async () => {
    const scopeIds: string[] = [];
    const created = await Promise.all(Array.from({ length: 55 }, (_, i) => user(`lb-trunc-${i}`)));
    for (const u of created) scopeIds.push(u.id);
    // 分數各自不同（1..55），方便驗證「前 50 名」精確等於分數最高的那 50 位。
    await Promise.all(created.map((u, i) => givePoints(u.id, i + 1)));

    const rows = await runLeaderboardQuery(scopeIds, LEADERBOARD_SIZE);
    expect(rows).toHaveLength(LEADERBOARD_SIZE);

    // 分數 1~5（最低的 5 位，對應 created[0..4]）應該被截斷掉、不在榜單裡。
    const excludedIds = created.slice(0, 5).map((u) => u.id);
    const includedIds = rows.map((r) => r.userId);
    for (const id of excludedIds) {
      expect(includedIds).not.toContain(id);
    }
    // 分數最高的那位（第 55 位，分數 55）一定在榜單第一名。
    expect(rows[0].userId).toBe(created[54].id);
    expect(rows[0].points).toBe(55);
  }, 60_000);
});
