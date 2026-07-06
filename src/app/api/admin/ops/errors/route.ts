import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";

// GET /api/admin/ops/errors — `/admin/ops` 慢查詢分頁的「error_logs 最新錯誤列表」
// （master-plan §8a 交付內容 3＋7）：依 `(source, occurred_at)` 索引查，可選依 source 篩選。
// moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const SOURCES = ["api", "background_job", "webhook"] as const;

function isSource(value: unknown): value is (typeof SOURCES)[number] {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
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

  const rawSource = searchParams.get("source");
  if (rawSource && !isSource(rawSource)) {
    return jsonError("UNPROCESSABLE", "source 篩選值無效");
  }
  const sourceFilter = rawSource && isSource(rawSource) ? rawSource : null;

  const rows = await db.errorLog.findMany({
    where: sourceFilter ? { source: sourceFilter } : undefined,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    errors: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
