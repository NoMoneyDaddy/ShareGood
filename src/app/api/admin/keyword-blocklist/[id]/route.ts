import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/admin/keyword-blocklist/[id] — 停用／重新啟用詞條（master-plan §9a
// 交付內容 3）。body: { isActive: boolean }。用軟停用（isActive）而不是刪除，
// 比照 Category.isActive 的既有風格，保留歷史紀錄方便稽核回溯。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.isActive !== "boolean") {
    return jsonError("UNPROCESSABLE", "請指定 isActive（true/false）");
  }

  const existing = await db.keywordBlocklist.findUnique({ where: { id } });
  if (!existing) return jsonError("NOT_FOUND", "找不到這筆關鍵字詞條");

  const updated = await db.keywordBlocklist.update({
    where: { id },
    data: { isActive: body.isActive },
  });

  await writeAudit({
    actorId: actor.id,
    action: body.isActive ? "keyword_blocklist.activate" : "keyword_blocklist.deactivate",
    targetType: "keyword_blocklist",
    targetId: id,
    detail: { keyword: updated.keyword },
  });

  return NextResponse.json({
    id: updated.id,
    keyword: updated.keyword,
    isActive: updated.isActive,
  });
}
