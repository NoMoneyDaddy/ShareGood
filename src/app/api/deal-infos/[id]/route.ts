import { type NextRequest, NextResponse } from "next/server";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { DEAL_INFO_HUMAN_TRANSITIONS } from "@/lib/deal-info";
import { checkFullBlock } from "@/lib/restrictions";

const VALID_STATUSES = new Set<string>(Object.values(DealInfoStatus));

// PATCH /api/deal-infos/[id] — DealInfo 人為狀態轉換（master-plan §9a 交付內容 1／2）：
// - pending_review → published／rejected：僅 moderator/admin（審核佇列的核准/駁回）。
// - stale → published：原投稿者本人或 moderator/admin（reactivate；round 遞增靠
//   src/lib/deal-info.ts 的 getCurrentDealInfoRound 從 audit_logs 反推，這裡不需要另外
//   寫任何「輪次」欄位，只要成功寫下 audit log 本身就已經讓下一輪回報自動生效）。
// 跳態／逆向轉換／未列在 DEAL_INFO_HUMAN_TRANSITIONS 的轉換一律 409（比照 M2 檢舉狀態機）。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const blocked = await checkFullBlock(user.id);
  if (blocked.blocked) return jsonError("FORBIDDEN", blocked.message);

  const { id } = await params;
  const dealInfo = await db.dealInfo.findUnique({ where: { id } });
  if (!dealInfo) return jsonError("NOT_FOUND", "找不到這則好康資訊");

  const body = await req.json().catch(() => null);
  const nextStatus = typeof body?.status === "string" ? body.status : "";
  if (!VALID_STATUSES.has(nextStatus)) {
    return jsonError("UNPROCESSABLE", "無效的狀態");
  }

  const allowed = DEAL_INFO_HUMAN_TRANSITIONS[dealInfo.status] ?? [];
  if (!allowed.includes(nextStatus as DealInfoStatus)) {
    return jsonError("CONFLICT", `無法從「${dealInfo.status}」轉換到「${nextStatus}」`);
  }

  const roles = new Set(user.roles.map((r) => r.role));
  const isModerator = roles.has("moderator") || roles.has("admin");

  if (dealInfo.status === DealInfoStatus.pending_review) {
    // 審核核准/駁回：僅 moderator/admin。
    if (!isModerator) return jsonError("FORBIDDEN", "需要 moderator 權限");
  } else if (dealInfo.status === DealInfoStatus.stale) {
    // reactivate：原投稿者本人或 moderator/admin。
    if (!isModerator && dealInfo.submitterId !== user.id) {
      return jsonError("FORBIDDEN", "只有原投稿者或 moderator/admin 可以將這則好康重新上架");
    }
  }

  const now = new Date();
  const isApproving = nextStatus === DealInfoStatus.published;
  const auditAction =
    dealInfo.status === DealInfoStatus.pending_review
      ? nextStatus === DealInfoStatus.published
        ? "deal_info.approve"
        : "deal_info.reject"
      : "deal_info.reactivate";

  // updateMany 帶 status: dealInfo.status 條件當樂觀鎖，比照 M2 檢舉狀態機／M5 抽籤既有
  // 慣例：兩個管理員同時操作、或投稿者與管理員同時操作同一筆時，只有先到的請求能真的轉換
  // 過去，另一個會看到 count 0（狀態已經不是它讀到的那個），回 409 請對方重新整理。
  const result = await db.$transaction(async (tx) => {
    const flipped = await tx.dealInfo.updateMany({
      where: { id, status: dealInfo.status },
      data: {
        status: nextStatus as DealInfoStatus,
        ...(isApproving && dealInfo.status === DealInfoStatus.pending_review
          ? { publishedAt: now }
          : {}),
      },
    });
    if (flipped.count !== 1) return { ok: false as const };

    await writeAudit({
      actorId: user.id,
      action: auditAction,
      targetType: "deal_info",
      targetId: id,
      detail: { fromStatus: dealInfo.status, toStatus: nextStatus },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "這則好康資訊狀態已被變更，請重新整理頁面");
  }

  return NextResponse.json({ id, status: nextStatus });
}
