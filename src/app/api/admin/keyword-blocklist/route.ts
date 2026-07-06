import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const KEYWORD_MIN = 1;
const KEYWORD_MAX = 100;
const PAGE_SIZE = 50;

// POST /api/admin/keyword-blocklist — 新增關鍵字黑名單詞條（master-plan §9a 交付內容 3，
// 研究 01「可立即修正」清單 #6）。moderator/admin 皆可操作，比照既有
// /api/admin/user-restrictions 的 RBAC 邊界寫法。keyword 欄位本身在 schema 有 @unique，
// 交給資料庫擋重複（P2002 → 409），不另外查一次再建立，避免額外一趟往返。
export async function POST(req: Request) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const body = await req.json().catch(() => null);
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (keyword.length < KEYWORD_MIN || keyword.length > KEYWORD_MAX) {
    return jsonError("UNPROCESSABLE", `關鍵字需為 ${KEYWORD_MIN}–${KEYWORD_MAX} 個字`);
  }

  try {
    const entry = await db.keywordBlocklist.create({ data: { keyword } });

    await writeAudit({
      actorId: actor.id,
      action: "keyword_blocklist.create",
      targetType: "keyword_blocklist",
      targetId: entry.id,
      detail: { keyword: entry.keyword },
    });

    return NextResponse.json(
      {
        id: entry.id,
        keyword: entry.keyword,
        isActive: entry.isActive,
        createdAt: entry.createdAt,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "這個關鍵字已經存在黑名單裡");
    }
    throw e;
  }
}

// GET /api/admin/keyword-blocklist — 詞條清單（cursor 分頁），moderator/admin 專用。
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

  const rows = await db.keywordBlocklist.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      isActive: r.isActive,
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
