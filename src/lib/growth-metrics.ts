import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// M12 產品成長儀表板（master-plan §10a／docs/plan/m12-product-growth.md 交付內容 6）：
// 「產品指標」而非工程指標，供 `/admin/growth` 使用。三個指標各自一個查詢函式，
// 集中在這裡讓 admin 頁與整合測試共用同一份口徑，不重複寫查詢邏輯。
//
// 三個函式都額外接受一個選填的 scope 參數（scopeUserIds／scopeItemIds），只用來讓整合
// 測試把查詢範圍鎖定在測試自己建立的資料上（比照既有 leaderboard-query.test.ts 對
// getLeaderboard 查詢條件的重現手法，這裡改成直接在函式簽章開一個口子，不用另外複製一份
// 查詢邏輯）；`/admin/growth` 頁面呼叫時不帶這個參數，行為與線上全站查詢完全一致。

const TERMINAL_ITEM_STATUSES = [
  "completed",
  "expired",
  "removed_by_user",
  "removed_by_moderator",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionMetric = {
  days: number;
  cohortSize: number;
  retainedCount: number;
  rate: number | null; // 0–1，cohortSize 為 0 時 null（避免除以零、前端顯示「尚無資料」）
};

type RetentionRow = { cohort_size: bigint | number; retained_count: bigint | number };

/**
 * D{n} 回訪率：cohort = Profile.createdAt 落在 [today-(n+7), today-n] 區間的使用者
 * （確保他們的第 n 天窗口已經完整走完，7 天寬的緩衝視窗）；分子＝cohort 中在
 * [signupDate, signupDate+n天] 內於 items／claim_comments／direct_shares（respondedAt）／
 * messages／contribution_events 任一張表留下 userId 紀錄的人數（去重）。
 *
 * 口徑細節見 docs/plan/m12-product-growth.md 交付內容 6：ShareGood 沒有 page-view 級
 * 追蹤，這裡的「回訪」定義為「有實際互動」，比純頁面瀏覽更嚴格。
 */
export async function getRetentionMetric(
  days: number,
  scopeUserIds?: string[],
): Promise<RetentionMetric> {
  const now = new Date();
  const cohortEnd = new Date(now.getTime() - days * DAY_MS);
  const cohortStart = new Date(now.getTime() - (days + 7) * DAY_MS);
  const cohortScopeFilter =
    scopeUserIds && scopeUserIds.length > 0
      ? Prisma.sql`AND user_id = ANY(${scopeUserIds})`
      : Prisma.empty;

  const rows = await db.$queryRaw<RetentionRow[]>(Prisma.sql`
    WITH cohort AS (
      SELECT user_id, created_at AS signup_at
      FROM profiles
      WHERE created_at >= ${cohortStart} AND created_at <= ${cohortEnd}
      ${cohortScopeFilter}
    ),
    activity AS (
      SELECT owner_id AS user_id, created_at FROM items
      UNION ALL
      SELECT user_id, created_at FROM claim_comments
      UNION ALL
      SELECT receiver_id AS user_id, responded_at AS created_at
        FROM direct_shares WHERE responded_at IS NOT NULL
      UNION ALL
      SELECT sender_id AS user_id, created_at FROM messages
      UNION ALL
      SELECT user_id, created_at FROM contribution_events
    ),
    retained AS (
      SELECT DISTINCT c.user_id
      FROM cohort c
      JOIN activity a
        ON a.user_id = c.user_id
       AND a.created_at >= c.signup_at
       AND a.created_at <= c.signup_at + (${days} * INTERVAL '1 day')
    )
    SELECT
      (SELECT COUNT(*) FROM cohort) AS cohort_size,
      (SELECT COUNT(*) FROM retained) AS retained_count
  `);

  const row = rows[0];
  const cohortSize = row ? Number(row.cohort_size) : 0;
  const retainedCount = row ? Number(row.retained_count) : 0;

  return {
    days,
    cohortSize,
    retainedCount,
    rate: cohortSize > 0 ? retainedCount / cohortSize : null,
  };
}

export type ConversionMetric = {
  windowDays: number;
  terminalCount: number; // 分母：窗口內 publishedAt 且已到終態的物品數
  completedCount: number; // 分子：其中 status = completed
  rate: number | null;
};

/**
 * 上架→成交轉換率：分母＝過去 windowDays 天內 publishedAt 落在窗口內、且已到達終態
 * （completed／expired／removed_by_user／removed_by_moderator）的物品數，刻意排除仍在
 * published／reserved／handover_pending 的物品（命運未定，算進分母會低估轉換率）；
 * 分子＝其中 status = completed 的數量。
 */
export async function getConversionRate(
  windowDays: number,
  scopeItemIds?: string[],
): Promise<ConversionMetric> {
  const windowStart = new Date(Date.now() - windowDays * DAY_MS);

  const grouped = await db.item.groupBy({
    by: ["status"],
    where: {
      publishedAt: { gte: windowStart },
      status: { in: [...TERMINAL_ITEM_STATUSES] },
      ...(scopeItemIds ? { id: { in: scopeItemIds } } : {}),
    },
    _count: { _all: true },
  });

  let terminalCount = 0;
  let completedCount = 0;
  for (const row of grouped) {
    terminalCount += row._count._all;
    if (row.status === "completed") completedCount = row._count._all;
  }

  return {
    windowDays,
    terminalCount,
    completedCount,
    rate: terminalCount > 0 ? completedCount / terminalCount : null,
  };
}

export type MedianCompletionMetric = {
  windowDays: number;
  sampleCount: number;
  medianSeconds: number | null;
};

type MedianRow = { median_seconds: number | string | null; sample_count: bigint | number };

/**
 * 成交中位時間：對 status = completed 且 publishedAt 落在窗口內的物品，計算
 * HandoverRecord.completedAt − Item.publishedAt 的中位數，用 PostgreSQL
 * percentile_cont(0.5) WITHIN GROUP（比照 src/app/api/admin/ops/performance/route.ts
 * 既定的 $queryRaw 寫法）。
 */
export async function getMedianCompletionTime(
  windowDays: number,
  scopeItemIds?: string[],
): Promise<MedianCompletionMetric> {
  const windowStart = new Date(Date.now() - windowDays * DAY_MS);
  const scopeFilter =
    scopeItemIds && scopeItemIds.length > 0
      ? Prisma.sql`AND i.id = ANY(${scopeItemIds})`
      : Prisma.empty;

  const rows = await db.$queryRaw<MedianRow[]>(Prisma.sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (hr.completed_at - i.published_at))
      ) AS median_seconds,
      COUNT(*) AS sample_count
    FROM items i
    JOIN handover_records hr ON hr.item_id = i.id
    WHERE i.status = 'completed' AND i.published_at >= ${windowStart}
    ${scopeFilter}
  `);

  const row = rows[0];
  const sampleCount = row ? Number(row.sample_count) : 0;
  const medianSeconds =
    row && row.median_seconds !== null ? Math.round(Number(row.median_seconds)) : null;

  return { windowDays, sampleCount, medianSeconds };
}
