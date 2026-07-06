import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const PAGE_SIZE = 50;

// GET /api/admin/data-purge-logs — retention job 執行紀錄查詢（master-plan §7a 交付內容 4／7），
// cursor 分頁，可選 policyKey 篩選。moderator/admin 可查看（唯讀，不影響資料存續，權限比
// 修改政策寬鬆）。
export async function GET(req: Request) {
  try {
    await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const policyKey = url.searchParams.get("policyKey") ?? undefined;

  const rows = await db.dataPurgeLog.findMany({
    where: policyKey ? { policyKey } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      policyKey: r.policyKey,
      targetType: r.targetType,
      targetId: r.targetId,
      actionTaken: r.actionTaken,
      skippedLegalHold: r.skippedLegalHold,
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
