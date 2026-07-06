import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { decryptCouponCode } from "@/lib/coupon-crypto";
import { db } from "@/lib/db";

// POST /api/items/[id]/coupon/reveal — 揭露優惠券券碼明文。
//
// 權限判斷（master-plan §8）：只有「交接已經確定」——物品狀態是 handover_pending（交接
// 進行中）或 completed（已完成）——的那位接手者才能看到明文。receiver 身分一律以
// HandoverRecord.receiverId 為準（跟 item 詳情頁、handover/ensure、thanks 這幾支既有
// API 判斷「誰是接手者」的方式一致，不另外發明一套）：
//   - 物品還在 published/reserved（交接還沒建立）→ 409 CONFLICT，交接還沒確定。
//   - 呼叫者不是 HandoverRecord 記錄的 receiverId（含物主本人、路人）→ 403 FORBIDDEN。
//   - 物品沒有優惠券資料 → 404 NOT_FOUND。
//
// 稽核：刻意先解密、解密成功後才寫入 CouponRevealLog，最後才回傳明文——如果順序反過來，
// 一旦解密失敗（金鑰設定錯誤、資料損毀等）會留下「已成功查看」的假紀錄，但使用者其實
// 沒看到券碼，稽核紀錄就不再等於「真的看到了」。也刻意不做「同一人重複揭露就不重複記錄」
// 的 idempotent 保護，揭露次數本身就是稽核想看到的資訊；log 寫入失敗就整支 API 500，
// 不會有「明文已經回傳但完全沒有稽核紀錄」的狀態。
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: {
      handoverRecord: true,
      couponDetail: { include: { secret: true } },
    },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");

  const secret = item.couponDetail?.secret;
  if (!secret) return jsonError("NOT_FOUND", "這個物品沒有優惠券資料");

  if (item.status !== "handover_pending" && item.status !== "completed") {
    return jsonError("CONFLICT", "交接尚未確定，還不能查看券碼");
  }
  if (!item.handoverRecord || item.handoverRecord.receiverId !== user.id) {
    return jsonError("FORBIDDEN", "只有接手者可以查看券碼");
  }

  const code = decryptCouponCode(secret);

  const revealLog = await db.couponRevealLog.create({
    data: { couponSecretId: secret.id, revealedBy: user.id },
    select: { revealedAt: true },
  });

  return NextResponse.json({ code, revealedAt: revealLog.revealedAt });
}
