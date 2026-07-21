import { afterAll, describe, expect, it } from "vitest";
import {
  getConversionRate,
  getMedianCompletionTime,
  getRetentionMetric,
} from "@/lib/growth-metrics";
import { api } from "../support/api";
import { cleanupTestData, createTestUser, grantRole, type TestUser } from "../support/auth";
import { db } from "../support/db";
import { pickCityAndCategory } from "../support/items";

const DAY_MS = 24 * 60 * 60 * 1000;

// M12 交付內容 6（產品成長儀表板，docs/plan/m12-product-growth.md）：三個指標各自的口徑
// 用手算的假資料驗證，`scopeUserIds`/`scopeItemIds` 選填參數把查詢鎖定在這次測試自己建立的
// 資料上，避免撞到資料庫裡其他測試的殘留資料（見 src/lib/growth-metrics.ts 的說明）。
describe("M12 交付內容 6：產品成長儀表板查詢", () => {
  const userIds: string[] = [];
  const itemIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  afterAll(async () => {
    await db.item.deleteMany({ where: { id: { in: itemIds } } });
    await cleanupTestData(userIds);
  }, 60_000);

  it("D7 回訪率：cohort 大小與回訪人數依手算樣本正確計算", async () => {
    const retained = await user("growth-retained");
    const notRetained = await user("growth-not-retained");
    const outsideCohort = await user("growth-outside-cohort");

    const now = Date.now();
    // N=7 的 cohort 視窗是 [now-14d, now-7d]；signupAt 落在視窗中間點。
    const signupAt = new Date(now - 10 * DAY_MS);
    await db.profile.update({ where: { userId: retained.id }, data: { createdAt: signupAt } });
    await db.profile.update({
      where: { userId: notRetained.id },
      data: { createdAt: signupAt },
    });
    // 太晚註冊，不在 cohort 視窗內（第 7 天窗口還沒走完）。
    await db.profile.update({
      where: { userId: outsideCohort.id },
      data: { createdAt: new Date(now - 1 * DAY_MS) },
    });

    // retained：註冊後第 3 天有活動（在 7 天窗口內）。
    await db.contributionEvent.create({
      data: {
        userId: retained.id,
        type: "share_completed",
        points: 10,
        createdAt: new Date(signupAt.getTime() + 3 * DAY_MS),
      },
    });
    // notRetained：完全沒有活動。
    // outsideCohort：即使有活動也不該影響 D7 結果（不在 cohort 裡）。
    await db.contributionEvent.create({
      data: {
        userId: outsideCohort.id,
        type: "share_completed",
        points: 10,
        createdAt: new Date(now - 0.5 * DAY_MS),
      },
    });

    const metric = await getRetentionMetric(7, [retained.id, notRetained.id, outsideCohort.id]);

    expect(metric.cohortSize).toBe(2); // 只有 retained／notRetained 落在 cohort 視窗
    expect(metric.retainedCount).toBe(1); // 只有 retained 有窗口內活動
    expect(metric.rate).toBeCloseTo(0.5);
  });

  it("D7 回訪率：活動落在註冊後第 8 天（超出 7 天窗口）不算回訪", async () => {
    const lateActivity = await user("growth-late-activity");
    const now = Date.now();
    const signupAt = new Date(now - 10 * DAY_MS);
    await db.profile.update({
      where: { userId: lateActivity.id },
      data: { createdAt: signupAt },
    });
    await db.contributionEvent.create({
      data: {
        userId: lateActivity.id,
        type: "share_completed",
        points: 10,
        createdAt: new Date(signupAt.getTime() + 8 * DAY_MS), // 超出 N=7 天窗口
      },
    });

    const metric = await getRetentionMetric(7, [lateActivity.id]);
    expect(metric.cohortSize).toBe(1);
    expect(metric.retainedCount).toBe(0);
  });

  async function createItemDirect(params: {
    ownerId: string;
    status: string;
    publishedAt: Date | null;
  }) {
    const { cityId, categoryId } = await pickCityAndCategory();
    const item = await db.item.create({
      data: {
        ownerId: params.ownerId,
        title: "成長指標測試物品",
        description: "整合測試用的假物品描述內容",
        categoryId,
        cityId,
        status: params.status as never,
        publishedAt: params.publishedAt,
      },
    });
    itemIds.push(item.id);
    return item.id;
  }

  it("上架→成交轉換率：分母只計入已到終態的物品，排除仍在 published/reserved/handover_pending 的物品", async () => {
    const owner = await user("growth-conversion-owner");
    const now = new Date();

    const completedId = await createItemDirect({
      ownerId: owner.id,
      status: "completed",
      publishedAt: now,
    });
    const expiredId = await createItemDirect({
      ownerId: owner.id,
      status: "expired",
      publishedAt: now,
    });
    const removedId = await createItemDirect({
      ownerId: owner.id,
      status: "removed_by_user",
      publishedAt: now,
    });
    // 未到終態的物品：命運未定，不該計入分母。
    const stillPublishedId = await createItemDirect({
      ownerId: owner.id,
      status: "published",
      publishedAt: now,
    });
    const stillReservedId = await createItemDirect({
      ownerId: owner.id,
      status: "reserved",
      publishedAt: now,
    });

    const metric = await getConversionRate(30, [
      completedId,
      expiredId,
      removedId,
      stillPublishedId,
      stillReservedId,
    ]);

    expect(metric.terminalCount).toBe(3); // completed + expired + removed_by_user
    expect(metric.completedCount).toBe(1);
    expect(metric.rate).toBeCloseTo(1 / 3);
  });

  it("上架→成交轉換率：publishedAt 在視窗外的物品不計入", async () => {
    const owner = await user("growth-conversion-window-owner");
    const outsideWindow = await createItemDirect({
      ownerId: owner.id,
      status: "completed",
      publishedAt: new Date(Date.now() - 40 * DAY_MS), // 超出 30 天視窗
    });

    const metric = await getConversionRate(30, [outsideWindow]);
    expect(metric.terminalCount).toBe(0);
    expect(metric.rate).toBeNull();
  });

  it("成交中位時間：percentile_cont(0.5) 計算結果與手算樣本一致", async () => {
    const owner = await user("growth-median-owner");
    const receiver = await user("growth-median-receiver");
    const now = new Date();

    // 三筆物品的完成耗時分別是 1 天、2 天、10 天，中位數應為 2 天（172800 秒）。
    const durationsDays = [1, 2, 10];
    for (const durationDays of durationsDays) {
      const publishedAt = new Date(now.getTime() - 15 * DAY_MS);
      const completedAt = new Date(publishedAt.getTime() + durationDays * DAY_MS);
      const itemId = await createItemDirect({
        ownerId: owner.id,
        status: "completed",
        publishedAt,
      });
      await db.handoverRecord.create({
        data: {
          itemId,
          receiverId: receiver.id,
          status: "completed",
          completedAt,
        },
      });
    }

    const metric = await getMedianCompletionTime(30, itemIds.slice(-durationsDays.length));
    expect(metric.sampleCount).toBe(3);
    expect(metric.medianSeconds).toBe(2 * 24 * 60 * 60);
  });

  it("非 moderator/admin 造訪 /admin/growth → 404；moderator 可見", async () => {
    const plainUser = await user("growth-page-plain");
    const mod = await user("growth-page-mod");
    await grantRole(mod.id, "moderator");

    const denied = await api("/admin/growth", { user: plainUser });
    expect(denied.status).toBe(404);

    const allowed = await api("/admin/growth", { user: mod });
    expect(allowed.status).toBe(200);
    expect(String(allowed.json)).toContain("成長指標");
  });
});
