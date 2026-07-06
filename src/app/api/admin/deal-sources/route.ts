import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const NAME_MAX = 100;
const NOTES_MAX = 500;
const DEFAULT_SOURCE_GRADE = "S1";

// GET /api/admin/deal-sources — S1 官方來源主檔列表（master-plan §9a 交付內容 2）。
// moderator/admin 皆可查看；只有這批人可以維護，一般使用者連讀取都不行（來源清單本身
// 不是公開資訊，公開頁只會顯示個別 DealInfo 關聯到的來源名稱，不會顯示整份清單）。
// 筆數固定是編輯手動維護的 S1 清單（初始 10 筆），不會無限成長，比照
// data-retention-policies 既有慣例回傳陣列、限制筆數，不做 SELECT *。
export async function GET() {
  try {
    await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 moderator 權限");
    }
    throw e;
  }

  const sources = await db.dealSource.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 200,
  });

  return NextResponse.json({
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      officialUrl: s.officialUrl,
      sourceGrade: s.sourceGrade,
      lastCheckedAt: s.lastCheckedAt,
      isActive: s.isActive,
      notes: s.notes,
    })),
  });
}

// POST /api/admin/deal-sources — 新增來源（moderator/admin）。scope guard（master-plan
// §9a 交付內容 2）：這裡只是「登記一筆官方來源」，不做任何自動抓取——後續要不要替這個
// 來源建立 DealInfo，仍然是編輯用 POST /api/deal-infos（sourceType=editorial）手動建立。
export async function POST(req: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 moderator 權限");
    }
    throw e;
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const officialUrl = typeof body?.officialUrl === "string" ? body.officialUrl.trim() : "";
  const notesRaw = typeof body?.notes === "string" ? body.notes.trim() : "";
  const sourceGrade =
    typeof body?.sourceGrade === "string" && body.sourceGrade.trim().length > 0
      ? body.sourceGrade.trim()
      : DEFAULT_SOURCE_GRADE;

  if (name.length < 1 || name.length > NAME_MAX) {
    return jsonError("UNPROCESSABLE", `來源名稱需為 1–${NAME_MAX} 個字`);
  }
  if (notesRaw.length > NOTES_MAX) {
    return jsonError("UNPROCESSABLE", `備註最多 ${NOTES_MAX} 個字`);
  }
  try {
    const parsed = new URL(officialUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("bad protocol");
  } catch {
    return jsonError("UNPROCESSABLE", "官方頁網址格式不正確");
  }

  const created = await db.dealSource.create({
    data: {
      name,
      officialUrl,
      sourceGrade,
      notes: notesRaw || null,
      lastCheckedAt: new Date(),
    },
  });

  await writeAudit({
    actorId: actor.id,
    action: "deal_source.create",
    targetType: "deal_source",
    targetId: created.id,
    detail: { name, officialUrl },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
