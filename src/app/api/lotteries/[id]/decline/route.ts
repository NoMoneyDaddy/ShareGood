import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { advanceLotteryVacancy } from "@/lib/lottery";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/lotteries/[id]/decline — 目前候選人主動婉拒，不必等 48h 逾時，立即觸發遞補
// （master-plan §5a 交付內容 6）。遞補邏輯與 job 的逾時遞補共用同一段
// `advanceLotteryVacancy`（src/lib/lottery.ts）。
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: lotteryId } = await params;
  const lottery = await db.lottery.findUnique({ where: { id: lotteryId } });
  if (!lottery) return jsonError("NOT_FOUND", "找不到這場抽籤");
  if (lottery.status !== "awaiting_confirmation" || lottery.currentRank === null) {
    return jsonError("CONFLICT", "這場抽籤目前沒有正在等待確認的候選人");
  }

  const result = await db.lotteryResult.findUnique({
    where: { lotteryId_rank: { lotteryId, rank: lottery.currentRank } },
  });
  if (!result || result.userId !== user.id) {
    return jsonError("FORBIDDEN", "現在不是輪到你回應");
  }
  if (result.status !== "offered") {
    return jsonError("CONFLICT", "這個名額已經被處理過了");
  }
  if (!result.confirmDeadline || result.confirmDeadline.getTime() <= Date.now()) {
    return jsonError("CONFLICT", "確認時間已過期，系統即將自動遞補下一位");
  }

  const outcome = await advanceLotteryVacancy({
    lotteryId,
    expectedRank: lottery.currentRank,
    resultId: result.id,
    newStatus: "declined",
    now: new Date(),
    actorId: user.id,
  });

  if (outcome === "skipped") {
    return jsonError("CONFLICT", "這個名額已經被處理過了，請重新整理頁面");
  }

  return NextResponse.json({ id: lotteryId, outcome });
}
