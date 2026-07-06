import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// POST /api/me/data-exports — 建立「匯出我的資料」請求（master-plan §7a 交付內容 2）。
// Server-side 檢查：同一使用者 24 小時內只能有一筆非終態（pending/processing）的匯出請求，
// 超過回 409（避免重複觸發浪費運算與 storage）。建立 PrivacyRequest(type=data_export,
// status=confirmed，data_export 無冷卻期) 與 DataExport(status=pending) 各一筆，同一 transaction。
export async function POST() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db.dataExport.findFirst({
    where: {
      userId: user.id,
      status: { in: ["pending", "processing"] },
      requestedAt: { gte: since },
    },
    select: { id: true },
  });
  if (existing) {
    return jsonError("CONFLICT", "24 小時內已有一筆匯出請求正在處理，請稍後再試");
  }

  const result = await db.$transaction(async (tx) => {
    const privacyRequest = await tx.privacyRequest.create({
      data: { userId: user.id, type: "data_export", status: "confirmed" },
    });
    const dataExport = await tx.dataExport.create({
      data: { userId: user.id, privacyRequestId: privacyRequest.id, status: "pending" },
    });
    return { privacyRequest, dataExport };
  });

  return NextResponse.json(
    {
      id: result.dataExport.id,
      privacyRequestId: result.privacyRequest.id,
      status: result.dataExport.status,
      requestedAt: result.dataExport.requestedAt,
    },
    { status: 201 },
  );
}

const PAGE_SIZE = 20;

// GET /api/me/data-exports — 我自己的匯出請求列表（cursor 分頁），/me/settings 用來顯示目前狀態。
export async function GET(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const rows = await db.dataExport.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      readyAt: r.readyAt,
      expiresAt: r.expiresAt,
      downloadCount: r.downloadCount,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
