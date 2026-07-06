import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatTaipeiDateTime } from "../format";
import { OpsNav } from "../ops-nav";
import { requireOpsPageAccess } from "../require-ops-access";

export const metadata = { title: "慢查詢 - 營運儀表板" };

const PAGE_SIZE = 20;
const WINDOW_HOURS = 24;

interface P95Row {
  label: string;
  p95: number | string | null;
  sample_count: bigint | number | string;
  max_duration_ms: number | null;
}

function toNumber(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

// `/admin/ops` 慢查詢分頁（master-plan §8a 交付內容 3＋7）：依 label 列出過去 24 小時的
// P95（`percentile_cont(0.95)` 即時聚合，不另建彙總表）、最近的慢查詢個案列表、
// error_logs 最新錯誤列表。三個列表各自獨立 cursor 分頁（query param 前綴避免互相干擾）。
export default async function AdminOpsPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ labelCursor?: string; slowCursor?: string; errorCursor?: string }>;
}) {
  await requireOpsPageAccess();
  const { labelCursor, slowCursor, errorCursor } = await searchParams;
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  const [p95Rows, slowQueries, errors] = await Promise.all([
    labelCursor
      ? db.$queryRaw<P95Row[]>`
          SELECT label, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                 COUNT(*) AS sample_count, MAX(duration_ms) AS max_duration_ms
          FROM performance_metrics
          WHERE metric_type = 'db_query' AND recorded_at >= ${windowStart} AND label > ${labelCursor}
          GROUP BY label ORDER BY label ASC LIMIT ${PAGE_SIZE + 1}
        `
      : db.$queryRaw<P95Row[]>`
          SELECT label, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                 COUNT(*) AS sample_count, MAX(duration_ms) AS max_duration_ms
          FROM performance_metrics
          WHERE metric_type = 'db_query' AND recorded_at >= ${windowStart}
          GROUP BY label ORDER BY label ASC LIMIT ${PAGE_SIZE + 1}
        `,
    db.performanceMetric.findMany({
      where: { isSlow: true },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(slowCursor ? { cursor: { id: slowCursor }, skip: 1 } : {}),
    }),
    db.errorLog.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(errorCursor ? { cursor: { id: errorCursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMoreLabels = p95Rows.length > PAGE_SIZE;
  const labelPage = hasMoreLabels ? p95Rows.slice(0, PAGE_SIZE) : p95Rows;
  const hasMoreSlow = slowQueries.length > PAGE_SIZE;
  const slowPage = hasMoreSlow ? slowQueries.slice(0, PAGE_SIZE) : slowQueries;
  const hasMoreErrors = errors.length > PAGE_SIZE;
  const errorPage = hasMoreErrors ? errors.slice(0, PAGE_SIZE) : errors;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">慢查詢與錯誤</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        過去 {WINDOW_HOURS} 小時依 label 分組的 P95、最近的慢查詢個案、最新錯誤紀錄。
      </p>

      <OpsNav active="/admin/ops/performance" />

      <h2 className="mt-8 text-lg font-semibold text-ink">
        依 label 的 P95（過去 {WINDOW_HOURS} 小時）
      </h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
        {labelPage.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">
            過去 {WINDOW_HOURS} 小時尚無查詢樣本
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-soft">
                <th className="px-4 py-2 font-medium">label</th>
                <th className="px-4 py-2 font-medium">P95</th>
                <th className="px-4 py-2 font-medium">最慢單筆</th>
                <th className="px-4 py-2 font-medium">樣本數</th>
              </tr>
            </thead>
            <tbody>
              {labelPage.map((row) => {
                const p95Ms = row.p95 === null ? null : Math.round(Number(row.p95));
                const isSlowP95 = p95Ms !== null && p95Ms > 1000;
                return (
                  <tr key={row.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-ink">{row.label}</td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(isSlowP95 && "font-semibold text-red-600 dark:text-red-400")}
                      >
                        {p95Ms === null ? "—" : `${p95Ms}ms`}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{row.max_duration_ms ?? "—"}ms</td>
                    <td className="px-4 py-2 text-ink-soft">{toNumber(row.sample_count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {hasMoreLabels && (
        <div className="mt-2 text-center">
          <Link
            href={`/admin/ops/performance?labelCursor=${labelPage[labelPage.length - 1].label}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多 label
          </Link>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink">最近的慢查詢個案</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
        {slowPage.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無慢查詢紀錄</p>
        ) : (
          <ul>
            {slowPage.map((m, index) => (
              <li
                key={m.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3 text-sm",
                  index > 0 && "border-t border-line",
                )}
              >
                <span className="font-mono text-xs text-ink">{m.label}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="destructive">{m.durationMs}ms</Badge>
                  <span className="text-xs text-ink-soft">
                    {formatTaipeiDateTime(m.recordedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hasMoreSlow && (
        <div className="mt-2 text-center">
          <Link
            href={`/admin/ops/performance?slowCursor=${slowPage[slowPage.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink">最新錯誤紀錄</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
        {errorPage.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無錯誤紀錄</p>
        ) : (
          <ul>
            {errorPage.map((err, index) => (
              <li
                key={err.id}
                className={cn("px-4 py-3 text-sm", index > 0 && "border-t border-line")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{err.source}</Badge>
                    {err.routeOrJob && (
                      <span className="font-mono text-xs text-ink-soft">{err.routeOrJob}</span>
                    )}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {formatTaipeiDateTime(err.occurredAt)}
                  </span>
                </div>
                <p className="mt-1 truncate text-ink">{err.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hasMoreErrors && (
        <div className="mt-2 text-center">
          <Link
            href={`/admin/ops/performance?errorCursor=${errorPage[errorPage.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
