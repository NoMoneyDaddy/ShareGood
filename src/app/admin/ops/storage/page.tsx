import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ChartLegend } from "../charts/chart-legend";
import { dayKeyToLabel, taipeiDateKey } from "../charts/date-buckets";
import { EmptyChartState } from "../charts/empty-chart-state";
import { TrendLineChart } from "../charts/line-chart";
import { formatBytes, formatTaipeiDateTime } from "../format";
import { OpsNav } from "../ops-nav";
import { requireOpsPageAccess } from "../require-ops-access";

export const metadata = { title: "Storage 用量 - 營運儀表板" };

const PAGE_SIZE = 20;
/** 用量成長圖表用，每個 bucket 最多畫這麼多筆快照（跟下面分頁列表的 cursor 無關，
 * 快照通常每天只跑一次 storage_usage_snapshot job，60 筆約可覆蓋 2 個月）。 */
const GROWTH_CHART_MAX_SNAPSHOTS_PER_BUCKET = 60;
/** 固定色階順序：只有一個 bucket 用 brand（單一系列不需要 legend）；多個 bucket
 * 時第二個開始才用 navy，這是全站僅有的兩個非中性色，刻意不引入新的圖表色相
 * （見 PR 說明：ShareGood 設計系統「全站僅此一個飽和色」）。 */
const BUCKET_COLOR_VARS = ["var(--color-brand)", "var(--color-navy)"];

const ITEM_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "待審核",
  published: "上架中",
  reserved: "已預約",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已到期",
  removed_by_user: "物主自行下架",
  removed_by_moderator: "管理員下架",
};

// `/admin/ops` Storage 分頁（master-plan §8a 交付內容 2＋7）：目前總用量、依物品狀態分類、
// 孤兒用量（帶「待清理」提示，只呈現不自動清除，見規格 scope guard）、歷史趨勢。
export default async function AdminOpsStoragePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  await requireOpsPageAccess();
  const { cursor } = await searchParams;

  const [latest, history] = await Promise.all([
    db.storageUsageSnapshot.findFirst({ orderBy: { snapshotAt: "desc" } }),
    db.storageUsageSnapshot.findMany({
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = history.length > PAGE_SIZE;
  const page = hasMore ? history.slice(0, PAGE_SIZE) : history;

  const byItemStatus =
    latest?.byItemStatus &&
    typeof latest.byItemStatus === "object" &&
    !Array.isArray(latest.byItemStatus)
      ? (latest.byItemStatus as Record<string, number>)
      : {};

  // 用量成長折線圖：依 bucket 分組，每個 bucket 同一天多筆快照取最後一筆，
  // 缺漏的日期沿用前一筆已知值（總用量本來就不會無中生有地掉回 0）。
  const growthRows = await db.storageUsageSnapshot.findMany({
    orderBy: { snapshotAt: "asc" },
    select: { bucket: true, totalBytes: true, snapshotAt: true },
  });
  const perBucketByDay = new Map<string, Map<string, bigint>>();
  for (const row of growthRows) {
    const dayKey = taipeiDateKey(row.snapshotAt);
    if (!perBucketByDay.has(row.bucket)) perBucketByDay.set(row.bucket, new Map());
    perBucketByDay.get(row.bucket)?.set(dayKey, row.totalBytes);
  }
  const bucketNames = Array.from(perBucketByDay.keys());
  const allDayKeysSet = new Set<string>();
  for (const dayMap of perBucketByDay.values()) {
    for (const key of dayMap.keys()) allDayKeysSet.add(key);
  }
  const allDayKeysSorted = Array.from(allDayKeysSet).sort();
  const growthDayKeys =
    allDayKeysSorted.length > GROWTH_CHART_MAX_SNAPSHOTS_PER_BUCKET
      ? allDayKeysSorted.slice(-GROWTH_CHART_MAX_SNAPSHOTS_PER_BUCKET)
      : allDayKeysSorted;
  const growthSeries = bucketNames.map((bucket, i) => {
    const dayMap = perBucketByDay.get(bucket) ?? new Map<string, bigint>();
    let lastKnown = 0;
    const values = growthDayKeys.map((key) => {
      const value = dayMap.get(key);
      if (value !== undefined) lastKnown = Number(value);
      return lastKnown;
    });
    return {
      key: bucket,
      name: bucket,
      colorVar: BUCKET_COLOR_VARS[i % BUCKET_COLOR_VARS.length],
      values,
      formatValue: (v: number) => formatBytes(v),
    };
  });
  const growthLabels = growthDayKeys.map(dayKeyToLabel);
  const hasGrowthData = growthDayKeys.length > 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Storage 用量</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        MinIO 實際用量、依物品狀態分類、孤兒用量（已下架但圖片未清除）。
      </p>

      <OpsNav active="/admin/ops/storage" />

      {!latest ? (
        <p className="mt-6 rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
          尚無快照資料，請先觸發 `storage_usage_snapshot` job
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs text-ink-soft">bucket「{latest.bucket}」總用量</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                {formatBytes(latest.totalBytes.toString())}
              </p>
              <p className="text-xs text-ink-soft">{latest.objectCount} 個物件</p>
            </div>
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2">
                <p className="text-xs text-ink-soft">孤兒用量</p>
                <Badge
                  variant="outline"
                  className="border-amber-500/50 text-amber-700 dark:text-amber-400"
                >
                  待清理
                </Badge>
              </div>
              <p className="mt-1 text-lg font-semibold text-ink">
                {formatBytes((latest.orphanedBytes ?? BigInt(0)).toString())}
              </p>
              <p className="text-xs text-ink-soft">
                {latest.orphanedCount ?? 0} 個物件（已下架，圖片未清除）
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs text-ink-soft">最後快照時間</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {formatTaipeiDateTime(latest.snapshotAt)}
              </p>
            </div>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-ink">依物品狀態分類</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
            {Object.keys(byItemStatus).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無資料</p>
            ) : (
              <ul>
                {Object.entries(byItemStatus).map(([status, bytes], index) => (
                  <li
                    key={status}
                    className={cn(
                      "flex items-center justify-between px-4 py-3 text-sm",
                      index > 0 && "border-t border-line",
                    )}
                  >
                    <span className="text-ink">{ITEM_STATUS_LABEL[status] ?? status}</span>
                    <span className="text-ink-soft">{formatBytes(bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink">用量成長趨勢</h2>
      <div className="mt-3 rounded-xl border border-line bg-card p-4">
        {hasGrowthData ? (
          <>
            <TrendLineChart
              labels={growthLabels}
              series={growthSeries}
              ariaLabel="依 bucket 分組的儲存用量成長折線圖"
            />
            {growthSeries.length > 1 && (
              <ChartLegend
                items={growthSeries.map((s, i) => ({
                  label: s.name,
                  swatchClassName: i === 0 ? "bg-brand" : "bg-navy",
                }))}
              />
            )}
          </>
        ) : (
          <EmptyChartState message="尚無快照資料，無法畫出成長趨勢" />
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink">歷史趨勢</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無快照紀錄</p>
        ) : (
          <ul>
            {page.map((snap, index) => (
              <li
                key={snap.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3 text-sm",
                  index > 0 && "border-t border-line",
                )}
              >
                <span className="text-ink">
                  {snap.bucket}・{formatBytes(snap.totalBytes.toString())}・{snap.objectCount}{" "}
                  個物件
                  {snap.orphanedBytes
                    ? `（孤兒 ${formatBytes(snap.orphanedBytes.toString())}）`
                    : ""}
                </span>
                <span className="text-xs text-ink-soft">
                  {formatTaipeiDateTime(snap.snapshotAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/ops/storage?cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
