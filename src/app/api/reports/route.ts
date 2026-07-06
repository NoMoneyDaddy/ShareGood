import { type NextRequest, NextResponse } from "next/server";
import { ReportCategory, ReportStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_EVIDENCE = 3;

const REPORT_CATEGORIES = new Set<string>(Object.values(ReportCategory));
const REPORT_STATUSES = new Set<string>(Object.values(ReportStatus));

/** 檢舉證據圖片 id 陣列格式檢查；未帶欄位視為沒有證據。回傳 null 代表格式不合法。 */
function parseEvidenceObjectIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_EVIDENCE) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) return null;
    ids.push(entry);
  }
  return ids;
}

// POST /api/reports — 對物品／留言／私訊三者之一提出檢舉（master-plan §7 第 2 項）。
// 三個目標欄位互斥（恰好指定一個），對應的目標必須存在；私訊額外檢查檢舉人是否為
// 該 conversation 的成員（比照 conversations/[id]/messages 的可見性規則），避免有人
// 檢舉自己看不到的私訊內容。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);

  const itemId = typeof body?.itemId === "string" && body.itemId.length > 0 ? body.itemId : null;
  const claimCommentId =
    typeof body?.claimCommentId === "string" && body.claimCommentId.length > 0
      ? body.claimCommentId
      : null;
  const messageId =
    typeof body?.messageId === "string" && body.messageId.length > 0 ? body.messageId : null;

  const targetCount = [itemId, claimCommentId, messageId].filter((v) => v !== null).length;
  if (targetCount !== 1) {
    return jsonError("UNPROCESSABLE", "請指定唯一的檢舉對象（物品／留言／私訊三選一）");
  }

  const category = typeof body?.category === "string" ? body.category : "";
  if (!REPORT_CATEGORIES.has(category)) {
    return jsonError("UNPROCESSABLE", "無效的檢舉分類");
  }

  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length < 1 || description.length > 1000) {
    return jsonError("UNPROCESSABLE", "檢舉說明需為 1–1000 個字");
  }

  const evidenceObjectIds = parseEvidenceObjectIds(body?.evidenceObjectIds);
  if (evidenceObjectIds === null) {
    return jsonError("UNPROCESSABLE", `證據圖片最多 ${MAX_EVIDENCE} 張`);
  }
  if (new Set(evidenceObjectIds).size !== evidenceObjectIds.length) {
    return jsonError("UNPROCESSABLE", "證據圖片不能重複使用");
  }

  // 目標存在性檢查；私訊額外檢查可見性（非成員一律當作找不到，不透露 conversation 存在）。
  if (itemId) {
    const item = await db.item.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  } else if (claimCommentId) {
    const claim = await db.claimComment.findUnique({
      where: { id: claimCommentId },
      select: { id: true },
    });
    if (!claim) return jsonError("NOT_FOUND", "找不到這則留言");
  } else if (messageId) {
    const message = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversation: { select: { members: { select: { userId: true } } } } },
    });
    if (!message?.conversation?.members.some((m) => m.userId === user.id)) {
      return jsonError("NOT_FOUND", "找不到這則私訊");
    }
  }

  // 逐一驗證證據圖片：必須是這個使用者自己上傳、狀態還是 pending、種類是 report_attachment
  // （比照 POST /api/items 對圖片來源的檢查方式）。
  if (evidenceObjectIds.length > 0) {
    const storageObjects = await db.storageObject.findMany({
      where: { id: { in: evidenceObjectIds } },
    });
    const byId = new Map(storageObjects.map((o) => [o.id, o]));
    for (const id of evidenceObjectIds) {
      const obj = byId.get(id);
      if (!obj) return jsonError("UNPROCESSABLE", "證據圖片不存在，請重新上傳");
      if (obj.uploaderId !== user.id) {
        return jsonError("FORBIDDEN", "不能使用他人上傳的圖片");
      }
      if (obj.status !== "pending") {
        return jsonError("UNPROCESSABLE", "證據圖片已被使用，請重新上傳");
      }
      if (obj.kind !== "report_attachment") {
        return jsonError("UNPROCESSABLE", "證據圖片格式不正確");
      }
    }
  }

  try {
    const report = await db.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          reporterId: user.id,
          itemId,
          claimCommentId,
          messageId,
          category: category as ReportCategory,
          description,
        },
      });

      if (evidenceObjectIds.length > 0) {
        await tx.reportEvidence.createMany({
          data: evidenceObjectIds.map((storageObjectId, index) => ({
            reportId: created.id,
            storageObjectId,
            sortOrder: index,
          })),
        });

        // 跟 POST /api/items 同一招：where 條件同時檢查 uploaderId/status，原子更新，
        // 併發搶用同一張證據圖片時只有一個請求能成功，另一個在下面拋錯回滾。
        const updated = await tx.storageObject.updateMany({
          where: { id: { in: evidenceObjectIds }, uploaderId: user.id, status: "pending" },
          data: { status: "linked", linkedAt: new Date() },
        });
        if (updated.count !== evidenceObjectIds.length) {
          throw new Error("EVIDENCE_ALREADY_USED");
        }
      }

      return created;
    });

    return NextResponse.json(
      { id: report.id, status: report.status, createdAt: report.createdAt },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "EVIDENCE_ALREADY_USED") {
      return jsonError("UNPROCESSABLE", "證據圖片已被使用，請重新上傳");
    }
    throw err;
  }
}

// GET /api/reports — 預設回自己提出的檢舉列表（cursor-based 分頁）。
// moderator/admin 可加 ?scope=all 看全部檢舉（後台處理用）；一般使用者帶這個參數一律 403。
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") === "all" ? "all" : "mine";

  if (scope === "all") {
    const roles = new Set(user.roles.map((r) => r.role));
    if (!roles.has("moderator") && !roles.has("admin")) {
      return jsonError("FORBIDDEN", "需要 moderator 權限");
    }
  }

  const statusParam = searchParams.get("status");
  const status =
    statusParam && REPORT_STATUSES.has(statusParam) ? (statusParam as ReportStatus) : undefined;

  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const where = {
    ...(scope === "mine" ? { reporterId: user.id } : {}),
    ...(status ? { status } : {}),
  };

  const reports = await db.report.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      category: true,
      status: true,
      description: true,
      createdAt: true,
      resolvedAt: true,
      resolutionNote: true,
      itemId: true,
      claimCommentId: true,
      messageId: true,
      reporter: { select: { id: true, profile: { select: { nickname: true } } } },
      item: { select: { id: true, title: true } },
      claimComment: { select: { id: true, message: true } },
      message: { select: { id: true, body: true } },
      evidence: {
        orderBy: { sortOrder: "asc" },
        select: { sortOrder: true, storageObject: { select: { objectKey: true } } },
      },
    },
  });

  const hasMore = reports.length > take;
  const page = hasMore ? reports.slice(0, take) : reports;

  return NextResponse.json({
    reports: page.map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      description: r.description,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolutionNote: r.resolutionNote,
      reporter: { id: r.reporter.id, nickname: r.reporter.profile?.nickname ?? "好物共享用戶" },
      target: {
        itemId: r.itemId,
        claimCommentId: r.claimCommentId,
        messageId: r.messageId,
        item: r.item,
        claimComment: r.claimComment,
        message: r.message,
      },
      evidence: r.evidence.map((e) => ({
        sortOrder: e.sortOrder,
        objectKey: e.storageObject.objectKey,
      })),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
