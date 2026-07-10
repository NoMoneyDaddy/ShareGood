import { afterAll, describe, expect, it } from "vitest";
import { CONTRIBUTION_POINTS, getUserSharingStats } from "@/lib/contribution";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// src/lib/contribution.ts 的 getUserSharingStats 是 /u/[userId] 公開個人頁與物品詳情頁
// 信任訊號共用的口徑：sharedCount/receivedCount 必須等於 contribution_events 裡
// share_completed/receive_completed 事件「筆數」（不是分數），totalPoints 則是所有事件
// （含 no_show 扣分）的加總分數。這裡直接寫 contribution_events 測資，繞過完整的
// 交接/感謝流程，只驗證這支聚合函式本身的口徑是否跟記分常數一致。
describe("getUserSharingStats：分享/接手統計口徑", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function writeEvent(userId: string, type: keyof typeof CONTRIBUTION_POINTS) {
    await db.contributionEvent.create({
      data: { userId, type, points: CONTRIBUTION_POINTS[type] },
    });
  }

  it("沒有任何 contribution_events 時，三個欄位都是 0", async () => {
    const u = await user("stats-empty");
    const stats = await getUserSharingStats(u.id);
    expect(stats).toEqual({ totalPoints: 0, sharedCount: 0, receivedCount: 0 });
  });

  it("分享完成兩次、接手完成一次：件數與總分都跟記分常數一致", async () => {
    const u = await user("stats-mixed");
    await writeEvent(u.id, "share_completed");
    await writeEvent(u.id, "share_completed");
    await writeEvent(u.id, "receive_completed");

    const stats = await getUserSharingStats(u.id);
    expect(stats.sharedCount).toBe(2);
    expect(stats.receivedCount).toBe(1);
    expect(stats.totalPoints).toBe(
      CONTRIBUTION_POINTS.share_completed * 2 + CONTRIBUTION_POINTS.receive_completed,
    );
  });

  it("no_show 扣分計入 totalPoints，但不計入 sharedCount 或 receivedCount", async () => {
    const u = await user("stats-noshow");
    await writeEvent(u.id, "share_completed");
    await writeEvent(u.id, "no_show");
    await writeEvent(u.id, "no_show");

    const stats = await getUserSharingStats(u.id);
    expect(stats.sharedCount).toBe(1);
    expect(stats.receivedCount).toBe(0);
    expect(stats.totalPoints).toBe(
      CONTRIBUTION_POINTS.share_completed + CONTRIBUTION_POINTS.no_show * 2,
    );
    expect(stats.totalPoints).toBeLessThan(CONTRIBUTION_POINTS.share_completed); // 淨分被扣成更低
  });

  it("只有 no_show（完全沒完成過任何分享/接手）時，totalPoints 為負、完成件數皆為 0", async () => {
    const u = await user("stats-only-noshow");
    await writeEvent(u.id, "no_show");

    const stats = await getUserSharingStats(u.id);
    expect(stats.totalPoints).toBe(CONTRIBUTION_POINTS.no_show);
    expect(stats.totalPoints).toBeLessThan(0);
    expect(stats.sharedCount).toBe(0);
    expect(stats.receivedCount).toBe(0);
  });

  it("不同使用者的事件互不影響（各自獨立統計）", async () => {
    const a = await user("stats-user-a");
    const b = await user("stats-user-b");
    await writeEvent(a.id, "share_completed");
    await writeEvent(b.id, "receive_completed");
    await writeEvent(b.id, "receive_completed");

    const statsA = await getUserSharingStats(a.id);
    const statsB = await getUserSharingStats(b.id);
    expect(statsA.sharedCount).toBe(1);
    expect(statsA.receivedCount).toBe(0);
    expect(statsB.sharedCount).toBe(0);
    expect(statsB.receivedCount).toBe(2);
  });
});
