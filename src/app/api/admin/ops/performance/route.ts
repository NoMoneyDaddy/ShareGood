import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";

// GET /api/admin/ops/performance — `/admin/ops` 慢查詢分頁的 P95 摘要（master-plan §8a
// 交付內容 3＋7）：依 label 分組、依時間窗篩選，用 PostgreSQL 內建的
// `percentile_cont(0.95) WITHIN GROUP` 對 performance_metrics 原始樣本即時聚合算出，
// 不另建彙總表（見規格說明）。moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 30; // 最多回看 30 天，跟 performance_metrics 30 天保留期一致

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

export async function GET(req: Request) {
  try {
    await requireOpsAccess();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const hoursParam = Number.parseInt(searchParams.get("hours") ?? "", 10);
  const hours =
    Number.isFinite(hoursParam) && hoursParam > 0
      ? Math.min(hoursParam, MAX_WINDOW_HOURS)
      : DEFAULT_WINDOW_HOURS;
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = cursor
    ? await db.$queryRaw<P95Row[]>`
        SELECT label,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
               COUNT(*) AS sample_count,
               MAX(duration_ms) AS max_duration_ms
        FROM performance_metrics
        WHERE metric_type = 'db_query' AND recorded_at >= ${windowStart} AND label > ${cursor}
        GROUP BY label
        ORDER BY label ASC
        LIMIT ${take + 1}
      `
    : await db.$queryRaw<P95Row[]>`
        SELECT label,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
               COUNT(*) AS sample_count,
               MAX(duration_ms) AS max_duration_ms
        FROM performance_metrics
        WHERE metric_type = 'db_query' AND recorded_at >= ${windowStart}
        GROUP BY label
        ORDER BY label ASC
        LIMIT ${take + 1}
      `;

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    windowHours: hours,
    labels: page.map((r) => ({
      label: r.label,
      p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)),
      sampleCount: toNumber(r.sample_count),
      maxDurationMs: r.max_duration_ms,
    })),
    nextCursor: hasMore ? page[page.length - 1].label : null,
  });
}
