import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const MAX_EVIDENCE = 3;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function parseEvidence(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE) return null;
  if (!value.every((v) => typeof v === "string" && v.length > 0)) return null;
  const evidence = value as string[];
  if (new Set(evidence).size !== evidence.length) return null;
  return evidence;
}

// POST /api/appeals — 被下架/被限制者對自己名下的 ItemRemoval 或 UserRestriction 提出申訴
// （master-plan §7 第 6 項）。itemRemovalId／userRestrictionId 二選一，恰好帶一個。
// 「每筆下架/限制紀錄只能申訴一次」靠 Appeal.itemRemovalId／userRestrictionId 的 @unique
// index 擋（見 prisma/schema.prisma 該處註解：Postgres unique index 允許多筆 NULL 但非
// NULL 值不可重複），這裡 catch P2002 回 409，不在應用層另外查重（比照
// src/app/api/items/[id]/claims/route.ts 的既有寫法）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const itemRemovalId =
    typeof body?.itemRemovalId === "string" && body.itemRemovalId.length > 0
      ? body.itemRemovalId
      : null;
  const userRestrictionId =
    typeof body?.userRestrictionId === "string" && body.userRestrictionId.length > 0
      ? body.userRestrictionId
      : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const evidence = parseEvidence(body?.evidence);

  if ((itemRemovalId && userRestrictionId) || (!itemRemovalId && !userRestrictionId)) {
    return jsonError("UNPROCESSABLE", "itemRemovalId 與 userRestrictionId 需擇一帶入");
  }
  if (reason.length < 1 || reason.length > 1000) {
    return jsonError("UNPROCESSABLE", "申訴理由需為 1–1000 個字");
  }
  if (!evidence) {
    return jsonError("UNPROCESSABLE", `附件最多 ${MAX_EVIDENCE} 張，且不可重複`);
  }

  // 驗證這筆下架/限制紀錄確實是本人的，不能申訴別人的紀錄。
  if (itemRemovalId) {
    const removal = await db.itemRemoval.findUnique({
      where: { id: itemRemovalId },
      select: { item: { select: { ownerId: true } } },
    });
    if (!removal) return jsonError("NOT_FOUND", "找不到這筆下架紀錄");
    if (removal.item.ownerId !== user.id) {
      return jsonError("FORBIDDEN", "不能申訴別人的下架紀錄");
    }
  } else if (userRestrictionId) {
    const restriction = await db.userRestriction.findUnique({ where: { id: userRestrictionId } });
    if (!restriction) return jsonError("NOT_FOUND", "找不到這筆限制紀錄");
    if (restriction.userId !== user.id) {
      return jsonError("FORBIDDEN", "不能申訴別人的限制紀錄");
    }
  }

  // 附件驗證比照 POST /api/items：必須是本人上傳、還沒被用掉、kind 對得上。
  if (evidence.length > 0) {
    const objects = await db.storageObject.findMany({ where: { id: { in: evidence } } });
    const byId = new Map(objects.map((o) => [o.id, o]));
    for (const objectId of evidence) {
      const obj = byId.get(objectId);
      if (!obj) return jsonError("UNPROCESSABLE", "附件不存在，請重新上傳");
      if (obj.uploaderId !== user.id) {
        return jsonError("FORBIDDEN", "不能使用他人上傳的附件");
      }
      if (obj.status !== "pending") {
        return jsonError("UNPROCESSABLE", "附件已被使用，請重新上傳");
      }
      if (obj.kind !== "appeal_attachment") {
        return jsonError("UNPROCESSABLE", "附件格式不正確");
      }
    }
  }

  try {
    const appeal = await db.$transaction(async (tx) => {
      const created = await tx.appeal.create({
        data: { userId: user.id, itemRemovalId, userRestrictionId, reason },
      });

      if (evidence.length > 0) {
        await tx.appealEvidence.createMany({
          data: evidence.map((storageObjectId, index) => ({
            appealId: created.id,
            storageObjectId,
            sortOrder: index,
          })),
        });

        // 原子性地把附件從 pending 轉 linked：同一批 storage object 理論上不會被兩個
        // 申訴同時搶（每個使用者只上傳給自己），但仍比照物品圖片的既有模式加這層防護。
        const updated = await tx.storageObject.updateMany({
          where: { id: { in: evidence }, uploaderId: user.id, status: "pending" },
          data: { status: "linked", linkedAt: new Date() },
        });
        if (updated.count !== evidence.length) {
          throw new Error("EVIDENCE_ALREADY_USED");
        }
      }

      return created;
    });

    return NextResponse.json({ id: appeal.id, status: appeal.status }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return jsonError("CONFLICT", "你已經對這筆紀錄申訴過了");
    }
    if (err instanceof Error && err.message === "EVIDENCE_ALREADY_USED") {
      return jsonError("UNPROCESSABLE", "附件已被使用，請重新上傳");
    }
    throw err;
  }
}

const APPEAL_STATUSES = new Set(["pending", "approved", "rejected"]);

// GET /api/appeals — 預設回傳自己的申訴列表；admin 額外可帶 `scope=all` 查全站待複審佇列
// （master-plan §7 第 6 項「admin 複審」——複審需要先看得到有哪些申訴，不然這支 API 只能
// 審自己剛好知道 id 的申訴）。cursor-based 分頁，比照既有慣例。
//
// 兩種查詢模式分別對應 Appeal 表上已建好的兩條索引（見 prisma/schema.prisma）：
//   - 一般使用者／admin 未帶 scope=all：`userId, createdAt` 索引，查自己的申訴。
//   - admin 帶 scope=all：`status, createdAt` 索引，查全站佇列（可選 status 篩選，
//     預設就是給 admin 用的「待審」畫面，所以不篩 status 時回全部狀態方便後台顯示歷史）。
// 非 admin 帶 scope=all 會被忽略、視為沒帶（不能看到別人的申訴列表）。
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

  const isAdmin = user.roles.some((r) => r.role === "admin");
  const wantsQueue = isAdmin && searchParams.get("scope") === "all";
  const statusParam = searchParams.get("status");
  const statusFilter = statusParam && APPEAL_STATUSES.has(statusParam) ? statusParam : undefined;
  if (statusParam && !statusFilter) {
    return jsonError("UNPROCESSABLE", "status 必須是 pending / approved / rejected");
  }

  type AppealStatusFilter = "pending" | "approved" | "rejected";
  const where = wantsQueue
    ? statusFilter
      ? { status: statusFilter as AppealStatusFilter }
      : {}
    : {
        userId: user.id,
        ...(statusFilter ? { status: statusFilter as AppealStatusFilter } : {}),
      };

  const appeals = await db.appeal.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      itemRemovalId: true,
      userRestrictionId: true,
      reason: true,
      status: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
    },
  });

  const hasMore = appeals.length > take;
  const page = hasMore ? appeals.slice(0, take) : appeals;

  return NextResponse.json({
    appeals: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
