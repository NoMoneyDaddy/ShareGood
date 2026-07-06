import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";

// GET /api/admin/ops/performance/slow — `/admin/ops` 慢查詢分頁的「最近慢查詢個案列表」
// （master-plan §8a 交付內容 3＋7）：`isSlow=true` 的即時旗標，依 `(is_slow, recorded_at)`
// 索引查。moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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

  const rows = await db.performanceMetric.findMany({
    where: { isSlow: true },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    slowQueries: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
