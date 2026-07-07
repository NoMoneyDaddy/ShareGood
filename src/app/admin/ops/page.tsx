import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ChartLegend } from "./charts/chart-legend";
import { StatusTimelineRow } from "./charts/status-timeline";
import { formatTaipeiDateTime, STATUS_DOT_CLASS, STATUS_LABEL } from "./format";
import { OpsNav } from "./ops-nav";
import { requireOpsPageAccess } from "./require-ops-access";

export const metadata = { title: "營運儀表板" };

const PAGE_SIZE = 20;
const SUBSYSTEMS = ["database", "storage", "background_jobs"] as const;
const SUBSYSTEM_LABEL: Record<(typeof SUBSYSTEMS)[number], string> = {
  database: "資料庫",
  storage: "儲存（MinIO）",
  background_jobs: "背景工作",
};
const TREND_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIMELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 每個子系統的時間線最多畫這麼多個色塊，避免 health_check_probe 密集執行時
 * 圖表被撐爆（見 dataviz 技能「向左/向右溢出都要避免」）。 */
const TIMELINE_MAX_POINTS = 60;

// `/admin/ops` 總覽分頁（master-plan §8a 交付內容 5＋7）：三個子系統目前狀態＋過去 24
// 小時歷史趨勢。moderator/admin 才能看，其餘一律 404（見 require-ops-access.ts）。
export default async function AdminOpsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  await requireOpsPageAccess();
  const { cursor } = await searchParams;

  const [latestPerSubsystem, trendCounts, recentChecks, timelineRows] = await Promise.all([
    Promise.all(
      SUBSYSTEMS.map((subsystem) =>
        db.healthCheck.findFirst({ where: { subsystem }, orderBy: { checkedAt: "desc" } }),
      ),
    ),
    db.healthCheck.groupBy({
      by: ["subsystem", "status"],
      where: { checkedAt: { gte: new Date(Date.now() - TREND_WINDOW_MS) } },
      _count: true,
    }),
    db.healthCheck.findMany({
      orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.healthCheck.findMany({
      where: { checkedAt: { gte: new Date(Date.now() - TIMELINE_WINDOW_MS) } },
      orderBy: { checkedAt: "asc" },
      select: { subsystem: true, status: true, checkedAt: true, latencyMs: true },
    }),
  ]);

  const hasMore = recentChecks.length > PAGE_SIZE;
  const page = hasMore ? recentChecks.slice(0, PAGE_SIZE) : recentChecks;

  function trendFor(subsystem: string) {
    return trendCounts
      .filter((c) => c.subsystem === subsystem)
      .map((c) => `${STATUS_LABEL[c.status] ?? c.status} ${c._count}`)
      .join("・");
  }

  function timelineFor(subsystem: string) {
    const rows = timelineRows.filter((r) => r.subsystem === subsystem);
    // 取最近的 TIMELINE_MAX_POINTS 筆，維持由舊到新排序。
    return rows.length > TIMELINE_MAX_POINTS ? rows.slice(-TIMELINE_MAX_POINTS) : rows;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">營運儀表板</h1>
      <p className="mt-1.5 text-sm text-ink-soft">三個子系統的健康狀態與過去 24 小時趨勢。</p>

      <OpsNav active="/admin/ops" />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {SUBSYSTEMS.map((subsystem, i) => {
          const latest = latestPerSubsystem[i];
          const status = latest?.status ?? "unknown";
          return (
            <div key={subsystem} className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    STATUS_DOT_CLASS[status] ?? "bg-ink-soft",
                  )}
                  aria-hidden
                />
                <p className="text-sm font-medium text-ink">{SUBSYSTEM_LABEL[subsystem]}</p>
              </div>
              <p className="mt-2 text-lg font-semibold text-ink">
                {STATUS_LABEL[status] ?? "尚無資料"}
              </p>
              {latest?.latencyMs != null && (
                <p className="text-xs text-ink-soft">延遲 {latest.latencyMs}ms</p>
              )}
              <p className="mt-2 text-xs text-ink-soft">
                過去 24 小時：{trendFor(subsystem) || "尚無紀錄"}
              </p>
              {latest && (
                <p className="mt-1 text-xs text-ink-soft">
                  最後檢查：{formatTaipeiDateTime(latest.checkedAt)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink">狀態時間線（近 7 天）</h2>
      <p className="mt-1 text-xs text-ink-soft">
        每個色塊代表一次健康檢查，由舊到新排列；滑過色塊可看到檢查時間與延遲。
      </p>
      <div className="mt-3 space-y-3 rounded-xl border border-line bg-card p-4">
        {SUBSYSTEMS.map((subsystem) => (
          <StatusTimelineRow
            key={subsystem}
            label={SUBSYSTEM_LABEL[subsystem]}
            points={timelineFor(subsystem)}
            statusLabel={STATUS_LABEL}
            statusDotClass={STATUS_DOT_CLASS}
          />
        ))}
        <ChartLegend
          items={Object.entries(STATUS_LABEL).map(([status, label]) => ({
            label,
            swatchClassName: STATUS_DOT_CLASS[status] ?? "bg-line",
          }))}
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink">歷史紀錄</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無檢查紀錄</p>
        ) : (
          <ul>
            {page.map((check, index) => (
              <li
                key={check.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3 text-sm",
                  index > 0 && "border-t border-line",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      STATUS_DOT_CLASS[check.status] ?? "bg-ink-soft",
                    )}
                    aria-hidden
                  />
                  <span className="font-medium text-ink">
                    {SUBSYSTEM_LABEL[check.subsystem as (typeof SUBSYSTEMS)[number]] ??
                      check.subsystem}
                  </span>
                  <Badge variant="outline">{STATUS_LABEL[check.status] ?? check.status}</Badge>
                </div>
                <span className="text-xs text-ink-soft">
                  {formatTaipeiDateTime(check.checkedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/ops?cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
