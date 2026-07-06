import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

type TargetInput = { targetType: string; targetId: string };

function isValidTargets(value: unknown): value is TargetInput[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (t) =>
        t &&
        typeof t === "object" &&
        typeof (t as TargetInput).targetType === "string" &&
        (t as TargetInput).targetType.length > 0 &&
        typeof (t as TargetInput).targetId === "string" &&
        (t as TargetInput).targetId.length > 0,
    )
  );
}

// POST /api/admin/legal-holds — 建立訴訟保全（master-plan §7a 交付內容 5）。只有 admin
// 可以建立/解除（比照規格明文要求）。一個 legal hold 可以同時保全多個目標（例如一起詐騙案
// 牽涉的 user、多個 item、多個 conversation）。
export async function POST(req: Request) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const relatedRequestId =
    typeof body?.relatedRequestId === "string" ? body.relatedRequestId : null;
  if (reason.length < 1 || reason.length > 1000) {
    return jsonError("UNPROCESSABLE", "請填寫保全原因（1–1000 字）");
  }
  if (!isValidTargets(body?.targets)) {
    return jsonError("UNPROCESSABLE", "請至少指定一個保全目標（targetType/targetId）");
  }

  // 去重：同一個 targetType+targetId 重複送出只留一筆，避免 legal_hold_targets 累積冗餘
  // 資料（不影響保全效力本身，filterUnderLegalHold 只看是否存在，但重複列會讓資料膨脹）。
  const uniqueTargets = Array.from(
    new Map(body.targets.map((t: TargetInput) => [`${t.targetType}:${t.targetId}`, t])).values(),
  ) as TargetInput[];

  const legalHold = await db.$transaction(async (tx) => {
    const hold = await tx.legalHold.create({
      data: { reason, relatedRequestId, createdBy: actor.id },
    });
    await tx.legalHoldTarget.createMany({
      data: uniqueTargets.map((t) => ({
        legalHoldId: hold.id,
        targetType: t.targetType,
        targetId: t.targetId,
      })),
    });
    await tx.legalHoldEvent.create({
      data: {
        legalHoldId: hold.id,
        action: "created",
        actorId: actor.id,
        note: `建立時保全 ${uniqueTargets.length} 個目標`,
      },
    });
    return hold;
  });

  await writeAudit({
    actorId: actor.id,
    action: "legal_hold.create",
    targetType: "legal_hold",
    targetId: legalHold.id,
    detail: { reason, targets: uniqueTargets },
    sensitive: true,
  });

  return NextResponse.json({ id: legalHold.id, status: legalHold.status }, { status: 201 });
}

const PAGE_SIZE = 30;

// GET /api/admin/legal-holds — 保全清單（cursor 分頁），可選 status 篩選；admin 專用。
export async function GET(req: Request) {
  try {
    await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const status = url.searchParams.get("status");
  const statusFilter = status === "active" || status === "released" ? status : undefined;

  const rows = await db.legalHold.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { targets: true },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    items: page.map((h) => ({
      id: h.id,
      reason: h.reason,
      status: h.status,
      createdBy: h.createdBy,
      createdAt: h.createdAt,
      releasedAt: h.releasedAt,
      targets: h.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
