import { NextResponse } from "next/server";
import type { SupportTicketCategory, SupportTicketStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const STATUSES: readonly SupportTicketStatus[] = ["open", "in_progress", "resolved", "closed"];
const CATEGORIES: readonly SupportTicketCategory[] = ["bug", "account", "other"];

function isStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

function isCategory(value: unknown): value is SupportTicketCategory {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

// GET /api/admin/support-tickets — moderator/admin 後台處理列表（master-plan §7 交付內容 5：
// 「使用者回報：bug 與帳號問題入口＋後台處理」）。跟 GET /api/support-tickets（一般使用者只看
// 自己的回報）分開成獨立 route，避免同一支端點混雜「本人視角」與「後台全域視角」兩種查詢
// 條件，也讓權限檢查一目了然（這支從頭到尾都要求 moderator/admin，沒有「本人也能看」的例外）。
export async function GET(req: Request) {
  let moderator: Awaited<ReturnType<typeof requireRole>>;
  try {
    moderator = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const rawStatus = searchParams.get("status");
  if (rawStatus && !isStatus(rawStatus)) {
    return jsonError("UNPROCESSABLE", "status 篩選值無效");
  }
  const statusParam: SupportTicketStatus | null =
    rawStatus && isStatus(rawStatus) ? rawStatus : null;

  const rawCategory = searchParams.get("category");
  if (rawCategory && !isCategory(rawCategory)) {
    return jsonError("UNPROCESSABLE", "category 篩選值無效");
  }
  const categoryParam: SupportTicketCategory | null =
    rawCategory && isCategory(rawCategory) ? rawCategory : null;
  // assigned=me → 只看指派給自己的；assigned=unassigned → 只看還沒人認領的；不帶則不篩選。
  const assignedParam = searchParams.get("assigned");
  if (assignedParam && assignedParam !== "me" && assignedParam !== "unassigned") {
    return jsonError("UNPROCESSABLE", "assigned 篩選值需為 me 或 unassigned");
  }

  // 注意：assignedTo 沒有獨立索引（schema 在 Wave 0 已凍結，本任務規則明文禁止再動
  // prisma/schema.prisma）；查詢仍會用到 status(_,created_at) 既有索引縮小範圍，在後台
  // 治理用途的資料量級（不是 items 那種高流量表）下可接受，之後若真的變慢再另外提案加索引。
  const where = {
    ...(statusParam ? { status: statusParam } : {}),
    ...(categoryParam ? { category: categoryParam } : {}),
    ...(assignedParam === "me" ? { assignedTo: moderator.id } : {}),
    ...(assignedParam === "unassigned" ? { assignedTo: null } : {}),
  };

  const tickets = await db.supportTicket.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      category: true,
      subject: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, profile: { select: { nickname: true } } } },
      assignee: { select: { id: true, profile: { select: { nickname: true } } } },
    },
  });

  const hasMore = tickets.length > take;
  const page = hasMore ? tickets.slice(0, take) : tickets;

  return NextResponse.json({
    tickets: page.map((t) => ({
      id: t.id,
      category: t.category,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: { id: t.user.id, nickname: t.user.profile?.nickname ?? "好物共享使用者" },
      assignee: t.assignee
        ? { id: t.assignee.id, nickname: t.assignee.profile?.nickname ?? "好物共享使用者" }
        : null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
