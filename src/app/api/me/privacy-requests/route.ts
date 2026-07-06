import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const COOLING_OFF_DAYS = 7;
const REASON_MAX = 500;

// POST /api/me/privacy-requests — 帳號刪除請求（master-plan §7a 交付內容 3）。目前只支援
// type=account_deletion（data_export 走專門的 POST /api/me/data-exports，不共用這支）。
// 進入 7 天冷卻期，期間可用 DELETE /api/me/privacy-requests/[id] 撤銷。
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  if (type !== "account_deletion") {
    return jsonError("UNPROCESSABLE", "目前只支援 type=account_deletion");
  }
  const reasonRaw = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reasonRaw.length > REASON_MAX) {
    return jsonError("UNPROCESSABLE", `刪除原因至多 ${REASON_MAX} 個字`);
  }

  // 同一使用者不能同時有兩筆進行中的帳號刪除請求（冷卻期中或處理中都算）。
  const existing = await db.privacyRequest.findFirst({
    where: {
      userId: user.id,
      type: "account_deletion",
      status: { in: ["cooling_off", "processing"] },
    },
    select: { id: true },
  });
  if (existing) {
    return jsonError("CONFLICT", "已有一筆帳號刪除請求正在進行中");
  }

  const coolingOffUntil = new Date(Date.now() + COOLING_OFF_DAYS * 24 * 60 * 60 * 1000);
  const request = await db.privacyRequest.create({
    data: {
      userId: user.id,
      type: "account_deletion",
      status: "cooling_off",
      reason: reasonRaw || null,
      coolingOffUntil,
    },
  });

  return NextResponse.json(
    { id: request.id, status: request.status, coolingOffUntil: request.coolingOffUntil },
    { status: 201 },
  );
}

const PAGE_SIZE = 20;

// GET /api/me/privacy-requests — 我自己送出過的請求列表（cursor 分頁）。
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

  const rows = await db.privacyRequest.findMany({
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
      type: r.type,
      status: r.status,
      reason: r.reason,
      coolingOffUntil: r.coolingOffUntil,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
