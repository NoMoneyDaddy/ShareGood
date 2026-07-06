import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// ⚠️ 法律免責聲明：本流程「誰能提出」「核准層級」「是否通知當事人」等判斷僅為技術實作
// 參考，正式營運前需台灣律師與平台法務審閱（見 master-plan.md §7a 節首與交付內容 6 聲明）。

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

// POST /api/admin/legal-requests — 機關調閱請求建檔（master-plan §7a 交付內容 6）。
// 本流程刻意不對外開放：一律由客服/admin 收到正式公文後手動建檔，不做機關線上送單介面。
// moderator/admin 皆可建檔（submitted_by），但核准者（approved_by）之後必須是不同人、且
// 限定 admin 角色（見 approve/route.ts）。
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
  const agencyName = typeof body?.agencyName === "string" ? body.agencyName.trim() : "";
  const caseReference = typeof body?.caseReference === "string" ? body.caseReference.trim() : "";
  const legalBasis = typeof body?.legalBasis === "string" ? body.legalBasis.trim() : "";
  const requestScope = typeof body?.requestScope === "string" ? body.requestScope.trim() : "";
  const receivedAtRaw = body?.receivedAt;
  const notifyUser = typeof body?.notifyUser === "boolean" ? body.notifyUser : true;

  if (!agencyName || !caseReference || !legalBasis || !requestScope) {
    return jsonError("UNPROCESSABLE", "機關名稱／案號／法源條文／調閱範圍皆為必填");
  }
  const receivedAt = new Date(receivedAtRaw);
  if (Number.isNaN(receivedAt.getTime())) {
    return jsonError("UNPROCESSABLE", "公文到站日期格式不正確");
  }
  if (!isValidTargets(body?.targets)) {
    return jsonError("UNPROCESSABLE", "請至少指定一個調閱範圍目標（targetType/targetId）");
  }

  const request = await db.$transaction(async (tx) => {
    const created = await tx.lawEnforcementRequest.create({
      data: {
        agencyName,
        caseReference,
        legalBasis,
        requestScope,
        receivedAt,
        notifyUser,
        submittedBy: actor.id,
        status: "submitted",
      },
    });
    await tx.lawEnforcementRequestTarget.createMany({
      data: (body.targets as TargetInput[]).map((t) => ({
        requestId: created.id,
        targetType: t.targetType,
        targetId: t.targetId,
      })),
    });
    await tx.lawEnforcementRequestEvent.create({
      data: { requestId: created.id, action: "submitted", actorId: actor.id },
    });
    return created;
  });

  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.create",
    targetType: "law_enforcement_request",
    targetId: request.id,
    detail: { agencyName, caseReference },
    sensitive: true,
  });

  return NextResponse.json({ id: request.id, status: request.status }, { status: 201 });
}

const PAGE_SIZE = 30;

// GET /api/admin/legal-requests — 調閱請求清單（cursor 分頁），moderator/admin 皆可查看。
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
  const status = url.searchParams.get("status") ?? undefined;

  const rows = await db.lawEnforcementRequest.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      agencyName: r.agencyName,
      caseReference: r.caseReference,
      status: r.status,
      submittedBy: r.submittedBy,
      approvedBy: r.approvedBy,
      receivedAt: r.receivedAt,
      createdAt: r.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
