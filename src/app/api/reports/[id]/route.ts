import { type NextRequest, NextResponse } from "next/server";
import { ReportStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

const REPORT_STATUSES = new Set<string>(Object.values(ReportStatus));

// 檢舉狀態機（master-plan §7）：submitted → triaged → in_progress → resolved/rejected → closed。
// 額外允許 submitted/triaged 直接 rejected（濫用/明顯無效檢舉不必走完整流程），
// 但不允許跳過 in_progress 直接 resolved，也不允許逆向轉換或繞過 closed 之後再變動。
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ["triaged", "rejected"],
  triaged: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: ["closed"],
  rejected: ["closed"],
  closed: [],
};

// PATCH /api/reports/[id] — moderator/admin 變更檢舉狀態＋填處理備註（master-plan §7 第 2 項
// 狀態機的「處理」端；下架/限制/申訴等後續動作留給後面 wave 的功能 agent）。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireRole>>;
  try {
    user = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 moderator 權限");
    }
    throw e;
  }

  const { id } = await params;
  const report = await db.report.findUnique({ where: { id } });
  if (!report) return jsonError("NOT_FOUND", "找不到這則檢舉");

  const body = await req.json().catch(() => null);
  const nextStatus = typeof body?.status === "string" ? body.status : "";
  if (!REPORT_STATUSES.has(nextStatus)) {
    return jsonError("UNPROCESSABLE", "無效的檢舉狀態");
  }

  const resolutionNote =
    typeof body?.resolutionNote === "string" ? body.resolutionNote.trim() : undefined;
  if (resolutionNote !== undefined && resolutionNote.length > 1000) {
    return jsonError("UNPROCESSABLE", "處理備註最多 1000 個字");
  }

  const allowed = ALLOWED_TRANSITIONS[report.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return jsonError("CONFLICT", `無法從「${report.status}」轉換到「${nextStatus}」`);
  }

  const isFinalizing = nextStatus === "resolved" || nextStatus === "rejected";
  if (isFinalizing && !resolutionNote) {
    return jsonError("UNPROCESSABLE", "結案（resolved/rejected）需填寫處理備註");
  }

  const now = new Date();
  // updateMany 帶 status: report.status 條件，原子性地確保只有一個管理員的請求能真的
  // 把狀態轉換過去：兩個管理員同時操作同一筆檢舉時，只有先到的那個會把 count 更新成 1，
  // 另一個會看到 count 0（狀態已經不是它讀到的那個 report.status 了），回 409 請對方重整。
  // audit log 只在真的轉換成功時才寫，跟着放在同一個 transaction 裡。
  const result = await db.$transaction(async (tx) => {
    const flipped = await tx.report.updateMany({
      where: { id, status: report.status },
      data: {
        status: nextStatus as ReportStatus,
        handledBy: user.id,
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        ...(isFinalizing ? { resolvedAt: now } : {}),
      },
    });

    if (flipped.count !== 1) {
      return { ok: false as const };
    }

    await writeAudit({
      actorId: user.id,
      action: "report.status_change",
      targetType: "report",
      targetId: id,
      detail: {
        fromStatus: report.status,
        toStatus: nextStatus,
        resolutionNote: resolutionNote ?? null,
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "檢舉狀態已被其他管理員變更，請重新整理頁面");
  }

  return NextResponse.json({
    id,
    status: nextStatus,
    resolutionNote: resolutionNote ?? report.resolutionNote,
    resolvedAt: isFinalizing ? now : report.resolvedAt,
    handledBy: user.id,
  });
}
