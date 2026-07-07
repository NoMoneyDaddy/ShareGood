import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const NAME_MAX = 100;
const NOTES_MAX = 500;

// PATCH /api/admin/deal-sources/[id] — 編輯來源資料，或帶 markVerified:true 一鍵「標記
// 已查證」（只更新 last_checked_at，可以跟其他欄位編輯一起送出）。moderator/admin 皆可
// （比照既有 /admin/* 頁大多數操作維持 moderator 就能做，只有 retention 政策等更敏感的
// 設定才收斂到 admin-only）。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 moderator 權限");
    }
    throw e;
  }

  const { id } = await params;
  const existing = await db.dealSource.findUnique({ where: { id } });
  if (!existing) return jsonError("NOT_FOUND", "找不到這個來源");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("UNPROCESSABLE", "請求格式不正確");

  const name = "name" in body && typeof body.name === "string" ? body.name.trim() : existing.name;
  const officialUrl =
    "officialUrl" in body && typeof body.officialUrl === "string"
      ? body.officialUrl.trim()
      : existing.officialUrl;
  const notes =
    "notes" in body
      ? typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null
      : existing.notes;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : existing.isActive;
  const markVerified = body.markVerified === true;

  if (name.length < 1 || name.length > NAME_MAX) {
    return jsonError("UNPROCESSABLE", `來源名稱需為 1–${NAME_MAX} 個字`);
  }
  if (notes && notes.length > NOTES_MAX) {
    return jsonError("UNPROCESSABLE", `備註最多 ${NOTES_MAX} 個字`);
  }
  try {
    const parsed = new URL(officialUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("bad protocol");
  } catch {
    return jsonError("UNPROCESSABLE", "官方頁網址格式不正確");
  }

  const updated = await db.dealSource.update({
    where: { id },
    data: {
      name,
      officialUrl,
      notes,
      isActive,
      ...(markVerified ? { lastCheckedAt: new Date() } : {}),
    },
  });

  await writeAudit({
    actorId: actor.id,
    action: markVerified ? "deal_source.mark_verified" : "deal_source.update",
    targetType: "deal_source",
    targetId: id,
    detail: {
      name: updated.name,
      officialUrl: updated.officialUrl,
      isActive: updated.isActive,
      lastCheckedAt: updated.lastCheckedAt,
    },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    officialUrl: updated.officialUrl,
    sourceGrade: updated.sourceGrade,
    lastCheckedAt: updated.lastCheckedAt,
    isActive: updated.isActive,
    notes: updated.notes,
  });
}
