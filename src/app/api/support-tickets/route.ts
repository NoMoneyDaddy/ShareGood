import { type NextRequest, NextResponse } from "next/server";
import type { SupportTicketCategory } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_ATTACHMENTS = 3; // master-plan §3.3：回報附件最多 3 張

const CATEGORIES: readonly SupportTicketCategory[] = ["bug", "account", "other"];

function isCategory(value: unknown): value is SupportTicketCategory {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

function parseAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  if (!value.every((v) => typeof v === "string" && v.length > 0)) return null;
  if (new Set(value).size !== value.length) return null;
  return value as string[];
}

// POST /api/support-tickets — 登入使用者建立回報（bug/account/other），可附最多 3 張圖片。
// 規格文字用「title」，但 PR #16 已定案的 schema 欄位叫 subject（見 prisma/schema.prisma
// SupportTicket model）；本 route 不動 schema，照 schema 走，request body 用 subject。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const category = body?.category;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const attachmentIds = parseAttachmentIds(body?.attachmentObjectIds);

  if (!isCategory(category)) {
    return jsonError("UNPROCESSABLE", "category 需為 bug / account / other");
  }
  if (subject.length < 2 || subject.length > 100) {
    return jsonError("UNPROCESSABLE", "標題需為 2–100 個字");
  }
  if (description.length < 1 || description.length > 3000) {
    return jsonError("UNPROCESSABLE", "說明需為 1–3000 個字");
  }
  if (!attachmentIds) {
    return jsonError("UNPROCESSABLE", `最多只能附 ${MAX_ATTACHMENTS} 張圖片`);
  }

  // 逐一驗證附件：必須是這個使用者自己上傳、狀態還是 pending（沒被其他實體用掉）、
  // 種類是 support_attachment——比照 POST /api/items 對圖片的檢查邏輯
  // （src/app/api/items/route.ts），避免有人拿別人上傳的 storage object 亂掛。
  if (attachmentIds.length > 0) {
    const storageObjects = await db.storageObject.findMany({
      where: { id: { in: attachmentIds } },
    });
    const byId = new Map(storageObjects.map((o) => [o.id, o]));
    for (const id of attachmentIds) {
      const obj = byId.get(id);
      if (!obj) return jsonError("UNPROCESSABLE", "附件不存在，請重新上傳");
      if (obj.uploaderId !== user.id) {
        return jsonError("FORBIDDEN", "不能使用他人上傳的圖片");
      }
      if (obj.status !== "pending") {
        return jsonError("UNPROCESSABLE", "附件已被使用，請重新上傳");
      }
      if (obj.kind !== "support_attachment") {
        return jsonError("UNPROCESSABLE", "附件格式不正確");
      }
    }
  }

  const now = new Date();
  try {
    const ticket = await db.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: { userId: user.id, category, subject, description, status: "open" },
      });

      if (attachmentIds.length > 0) {
        await tx.supportTicketAttachment.createMany({
          data: attachmentIds.map((storageObjectId, index) => ({
            ticketId: created.id,
            storageObjectId,
            sortOrder: index,
          })),
        });

        // 跟 POST /api/items 同一招：where 條件同時檢查 uploaderId/status，事務內原子
        // 更新，避免同一張附件被併發用在兩個不同的 ticket 上。
        const updated = await tx.storageObject.updateMany({
          where: { id: { in: attachmentIds }, uploaderId: user.id, status: "pending" },
          data: { status: "linked", linkedAt: now },
        });
        if (updated.count !== attachmentIds.length) {
          throw new Error("ATTACHMENT_ALREADY_USED");
        }
      }

      return created;
    });

    return NextResponse.json(
      {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "ATTACHMENT_ALREADY_USED") {
      return jsonError("UNPROCESSABLE", "附件已被使用，請重新上傳");
    }
    throw err;
  }
}

// GET /api/support-tickets — 目前登入者自己的回報列表（cursor-based 分頁）。
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const tickets = await db.supportTicket.findMany({
    where: { userId: user.id },
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
    },
  });

  const hasMore = tickets.length > take;
  const page = hasMore ? tickets.slice(0, take) : tickets;

  return NextResponse.json({
    tickets: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
