import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/admin/legal-holds/[id] — 解除保全（master-plan §7a 交付內容 5）。只有 admin
// 可以解除。解除需記錄 released_by/released_at，legal_hold_events 寫入 released 事件。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("admin");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (body?.action !== "release") {
    return jsonError("UNPROCESSABLE", "目前只支援 action=release");
  }

  const hold = await db.legalHold.findUnique({ where: { id } });
  if (!hold) return jsonError("NOT_FOUND", "找不到這筆保全紀錄");
  if (hold.status !== "active") return jsonError("CONFLICT", "這筆保全已經解除過了");

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.legalHold.update({
      where: { id },
      data: { status: "released", releasedBy: actor.id, releasedAt: now },
    });
    await tx.legalHoldEvent.create({
      data: { legalHoldId: id, action: "released", actorId: actor.id },
    });
  });

  await writeAudit({
    actorId: actor.id,
    action: "legal_hold.release",
    targetType: "legal_hold",
    targetId: id,
    sensitive: true,
  });

  return NextResponse.json({ id, status: "released" });
}
