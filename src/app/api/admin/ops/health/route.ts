import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";

// GET /api/admin/ops/health — `/admin/ops` 總覽分頁（master-plan §8a 交付內容 5＋7）：
// 三個子系統目前狀態＋歷史趨勢。moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const SUBSYSTEMS = ["database", "storage", "background_jobs"] as const;
type Subsystem = (typeof SUBSYSTEMS)[number];

function isSubsystem(value: unknown): value is Subsystem {
  return typeof value === "string" && (SUBSYSTEMS as readonly string[]).includes(value);
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

  const rawSubsystem = searchParams.get("subsystem");
  if (rawSubsystem && !isSubsystem(rawSubsystem)) {
    return jsonError("UNPROCESSABLE", "subsystem 篩選值無效");
  }
  const subsystemFilter = rawSubsystem && isSubsystem(rawSubsystem) ? rawSubsystem : null;

  const latestPerSubsystem = await Promise.all(
    SUBSYSTEMS.map((subsystem) =>
      db.healthCheck.findFirst({ where: { subsystem }, orderBy: { checkedAt: "desc" } }),
    ),
  );

  const history = await db.healthCheck.findMany({
    where: subsystemFilter ? { subsystem: subsystemFilter } : undefined,
    orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = history.length > take;
  const page = hasMore ? history.slice(0, take) : history;

  return NextResponse.json({
    latest: Object.fromEntries(
      SUBSYSTEMS.map((subsystem, i) => {
        const row = latestPerSubsystem[i];
        return [
          subsystem,
          row
            ? {
                status: row.status,
                latencyMs: row.latencyMs,
                detail: row.detail,
                checkedAt: row.checkedAt,
              }
            : null,
        ];
      }),
    ),
    history: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
