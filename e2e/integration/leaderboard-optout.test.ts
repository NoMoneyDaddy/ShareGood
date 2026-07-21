import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, type TestUser } from "../support/auth";
import { db } from "../support/db";

// M12 交付內容 4（排行榜 opt-out，docs/plan/m12-product-growth.md）：Profile.leaderboardOptOut
// 單一全站開關，貢獻值仍照算，只是 /leaderboard 撈不到這個人；/u/[userId] 不受影響。
const LEADERBOARD_SIZE = 50;

async function runLeaderboardQuery(scopeUserIds: string[]): Promise<string[]> {
  // 重現 src/app/(shell)/leaderboard/page.tsx 的 getLeaderboard 查詢條件（跟既有
  // leaderboard-query.test.ts 同一套理由：getLeaderboard 包在 unstable_cache 裡，
  // 不直接測快取層，改重現同一組查詢條件）。
  const grouped = await db.contributionEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: scopeUserIds } },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: LEADERBOARD_SIZE * 4,
  });
  const candidates = grouped
    .map((g) => ({ userId: g.userId, points: g._sum.points ?? 0 }))
    .filter((g) => g.points > 0);
  if (candidates.length === 0) return [];

  const users = await db.user.findMany({
    where: {
      id: { in: candidates.map((c) => c.userId) },
      deletedAt: null,
      profile: { leaderboardOptOut: false },
    },
    select: { id: true },
  });
  const allowedIds = new Set(users.map((u) => u.id));
  return candidates.filter((c) => allowedIds.has(c.userId)).map((c) => c.userId);
}

describe("M12 交付內容 4：排行榜 opt-out", () => {
  const userIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await cleanupTestData(userIds);
  }, 60_000);

  it("Profile 預設 leaderboardOptOut 為 false（既有使用者行為不變）", async () => {
    const u = await user("optout-default");
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(profile.leaderboardOptOut).toBe(false);
  });

  it("POST /api/profile 可以開啟 leaderboardOptOut；未帶欄位時維持既有值", async () => {
    const u = await user("optout-toggle");

    const on = await api("/api/profile", {
      method: "POST",
      user: u,
      body: { nickname: u.nickname, cityId: null, leaderboardOptOut: true },
    });
    expect(on.status).toBe(200);
    expect((on.json as { leaderboardOptOut: boolean }).leaderboardOptOut).toBe(true);

    const dbProfile = await db.profile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(dbProfile.leaderboardOptOut).toBe(true);

    // 沒帶 leaderboardOptOut 欄位的呼叫（例如只是改暱稱）不應該把值改回 false。
    // u.nickname 本身已經被 createTestUser 截到 20 字上限，這裡改用固定短暱稱避免超長 422。
    const rename = await api("/api/profile", {
      method: "POST",
      user: u,
      body: { nickname: "改名後的暱稱", cityId: null },
    });
    expect(rename.status).toBe(200);
    const dbProfileAfterRename = await db.profile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(dbProfileAfterRename.leaderboardOptOut).toBe(true);
  });

  it("opt-out 使用者的貢獻值仍計入 contribution_events，但 /leaderboard 查詢撈不到他；opt-in 使用者正常出現", async () => {
    const optOutUser = await user("optout-excluded");
    const normalUser = await user("optout-included");

    await db.contributionEvent.create({
      data: { userId: optOutUser.id, type: "share_completed", points: 999 },
    });
    await db.contributionEvent.create({
      data: { userId: normalUser.id, type: "share_completed", points: 10 },
    });

    await api("/api/profile", {
      method: "POST",
      user: optOutUser,
      body: { nickname: optOutUser.nickname, cityId: null, leaderboardOptOut: true },
    });

    // 分數本身仍然真實存在（不做假的分數隱藏）。
    const score = await db.contributionEvent.aggregate({
      where: { userId: optOutUser.id },
      _sum: { points: true },
    });
    expect(score._sum.points).toBe(999);

    const rows = await runLeaderboardQuery([optOutUser.id, normalUser.id]);
    expect(rows).not.toContain(optOutUser.id);
    expect(rows).toContain(normalUser.id);
  });

  it("opt-out 之後個人頁 /u/[userId] 仍然顯示貢獻值與統計（不受 opt-out 影響）", async () => {
    const optOutUser = await user("optout-profile-still-visible");
    await db.contributionEvent.create({
      data: { userId: optOutUser.id, type: "share_completed", points: 10 },
    });
    await api("/api/profile", {
      method: "POST",
      user: optOutUser,
      body: { nickname: optOutUser.nickname, cityId: null, leaderboardOptOut: true },
    });

    const profilePage = await api(`/u/${optOutUser.id}`);
    expect(profilePage.status).toBe(200);
    expect(String(profilePage.json)).toContain("10");
  });
});
