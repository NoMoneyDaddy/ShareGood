import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { NOTIFICATION_MAX_ATTEMPTS } from "@/lib/ops-config";
import { cn } from "@/lib/utils";
import { StackedBarChart } from "../charts/bar-chart";
import { ChartLegend } from "../charts/chart-legend";
import { dayKeyToLabel, lastNDayKeys, taipeiDateKey } from "../charts/date-buckets";
import { EmptyChartState } from "../charts/empty-chart-state";
import { formatTaipeiDateTime } from "../format";
import { OpsNav } from "../ops-nav";
import { requireOpsPageAccess } from "../require-ops-access";

export const metadata = { title: "通知重送 - 營運儀表板" };

const PAGE_SIZE = 20;
const TREND_DAYS = 7;

interface RetryDailyRow {
  day: Date;
  status: string;
  count: bigint | number | string;
}

function toNumber(value: bigint | number | string): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}
const SCOPE_TABS = [
  { value: "all", label: "全部" },
  { value: "retrying", label: "重送中" },
  { value: "maxed", label: "已達重試上限" },
] as const;

function isScope(value: string | undefined): value is "retrying" | "maxed" {
  return value === "retrying" || value === "maxed";
}

// `/admin/ops` 通知分頁（master-plan §8a 交付內容 6＋7）：重送中／已達重試上限的
// `notification_deliveries` 列表。
export default async function AdminOpsNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; cursor?: string }>;
}) {
  await requireOpsPageAccess();
  const { scope: rawScope, cursor } = await searchParams;
  const scope = isScope(rawScope) ? rawScope : undefined;

  const attemptsFilter =
    scope === "retrying"
      ? { lt: NOTIFICATION_MAX_ATTEMPTS }
      : scope === "maxed"
        ? { gte: NOTIFICATION_MAX_ATTEMPTS }
        : undefined;

  const trendWindowStart = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);

  const [deliveries, retryDailyRows] = await Promise.all([
    db.notificationDelivery.findMany({
      where: { status: "failed", ...(attemptsFilter ? { attempts: attemptsFilter } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        notification: {
          select: {
            type: true,
            payload: true,
            user: { select: { profile: { select: { nickname: true } } } },
          },
        },
      },
    }),
    // 近 7 天「實際發生過重送」的結果（attempts > 0）依日期＋狀態分組，畫成功／
    // 失敗堆疊圖；只看重送過的，不含從沒被 job 挑中過的 pending 紀錄。
    db.$queryRaw<RetryDailyRow[]>`
      SELECT date_trunc('day', last_attempt_at) AS day, status, COUNT(*) AS count
      FROM notification_deliveries
      WHERE attempts > 0 AND last_attempt_at >= ${trendWindowStart}
      GROUP BY 1, 2 ORDER BY 1
    `,
  ]);
  const hasMore = deliveries.length > PAGE_SIZE;
  const page = hasMore ? deliveries.slice(0, PAGE_SIZE) : deliveries;

  const dayKeys = lastNDayKeys(TREND_DAYS);
  const countsByDayAndStatus = new Map<string, Map<string, number>>();
  for (const row of retryDailyRows) {
    const dayKey = taipeiDateKey(row.day);
    if (!countsByDayAndStatus.has(dayKey)) countsByDayAndStatus.set(dayKey, new Map());
    countsByDayAndStatus.get(dayKey)?.set(row.status, toNumber(row.count));
  }
  const retryChartData = dayKeys.map((key) => {
    const byStatus = countsByDayAndStatus.get(key);
    return {
      key,
      label: dayKeyToLabel(key),
      segments: [
        {
          name: "成功",
          value: byStatus?.get("sent") ?? 0,
          className: "bg-emerald-500 dark:bg-emerald-400",
        },
        {
          name: "失敗",
          value: byStatus?.get("failed") ?? 0,
          className: "bg-red-500 dark:bg-red-400",
        },
      ],
    };
  });
  const hasRetryData = retryChartData.some((d) => d.segments.some((s) => s.value > 0));

  function tabHref(value: string) {
    return value === "all" ? "/admin/ops/notifications" : `/admin/ops/notifications?scope=${value}`;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">通知重送</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        Telegram 外部通知失敗重送中，或已達重試上限（{NOTIFICATION_MAX_ATTEMPTS} 次）的紀錄。
      </p>

      <OpsNav active="/admin/ops/notifications" />

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="依重試狀態篩選">
        {SCOPE_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabHref(tab.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              (scope ?? "all") === tab.value
                ? "border-brand bg-brand/10 font-medium text-brand-ink"
                : "border-line text-ink-soft hover:bg-paper-2",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold text-ink">近 7 天重送成功／失敗</h2>
        <div className="mt-4">
          {hasRetryData ? (
            <>
              <StackedBarChart
                data={retryChartData}
                ariaLabel="近 7 天通知重送成功與失敗次數堆疊圖"
              />
              <ChartLegend
                items={[
                  { label: "成功", swatchClassName: "bg-emerald-500 dark:bg-emerald-400" },
                  { label: "失敗", swatchClassName: "bg-red-500 dark:bg-red-400" },
                ]}
              />
            </>
          ) : (
            <EmptyChartState message="近 7 天尚無重送紀錄" />
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">目前沒有符合條件的紀錄</p>
        ) : (
          <ul>
            {page.map((d, index) => {
              const maxed = d.attempts >= NOTIFICATION_MAX_ATTEMPTS;
              return (
                <li
                  key={d.id}
                  className={cn("px-4 py-3 text-sm", index > 0 && "border-t border-line")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-ink">
                        {d.notification.user.profile?.nickname ?? "好物共享使用者"}
                      </span>
                      <Badge variant="outline">{d.notification.type}</Badge>
                      <Badge variant={maxed ? "destructive" : "secondary"}>
                        {maxed
                          ? "已達重試上限"
                          : `重試中（${d.attempts}/${NOTIFICATION_MAX_ATTEMPTS}）`}
                      </Badge>
                    </span>
                    <span className="text-xs text-ink-soft">
                      {d.lastAttemptAt ? formatTaipeiDateTime(d.lastAttemptAt) : "尚未嘗試"}
                    </span>
                  </div>
                  {d.lastError && (
                    <p className="mt-1 truncate text-xs text-ink-soft">{d.lastError}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`${tabHref(scope ?? "all")}${scope ? "&" : "?"}cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
