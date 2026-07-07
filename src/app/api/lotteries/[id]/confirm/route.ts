import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/lotteries/[id]/confirm — 目前 current_rank 對應的候選人本人確認中選
// （master-plan §5a 交付內容 6）。同一個 transaction 內：該 lottery_results 列轉
// confirmed、lotteries 轉 completed、items 轉 reserved，並補寫一筆 ClaimComment
// （status=accepted）——這不是新發明的資料表或欄位，只是借用 M1 既有「誰是這個物品的
// 接受者」查詢管道（POST /api/items/[id]/handover/ensure 靠 acceptedClaim/acceptedDirectShare
// 找 receiverId），讓抽籤產生的配對可以「無痛」接續既有交接流程而完全不必修改
// handover/ensure 或後續任何一支既有 API（規格明確要求 M1 既有 API 不動一行）。
// 因為物品在整個抽籤期間都維持 published，且 published 狀態下依 claims/route.ts 的邏輯
// 不可能存在任何 ClaimComment（第一筆成功留言必定立刻把物品轉離 published），
// 這裡新增的 (itemId, userId) 一定不會撞到既有列的 unique constraint。
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
    return jsonError("FORBIDDEN", "現在不是輪到你確認");
  }
  if (result.status !== "offered") {
    return jsonError("CONFLICT", "這個名額已經被處理過了");
  }
  if (!result.confirmDeadline || result.confirmDeadline.getTime() <= Date.now()) {
    return jsonError("CONFLICT", "確認時間已過期，系統即將自動遞補下一位");
  }

  const now = new Date();

  let outcome: "completed" | "conflict";
  try {
    outcome = await db.$transaction(async (tx) => {
      const confirmed = await tx.lotteryResult.updateMany({
        where: { id: result.id, status: "offered" },
        data: { status: "confirmed", respondedAt: now },
      });
      if (confirmed.count === 0) return "conflict" as const;

      const lotteryUpdated = await tx.lottery.updateMany({
        where: { id: lotteryId, status: "awaiting_confirmation" },
        data: { status: "completed", completedAt: now },
      });
      if (lotteryUpdated.count === 0) return "conflict" as const;

      // 依規格設計，物品在整場抽籤期間應全程維持 published（留言/直贈已被 409 擋下，
      // 不會有其他路徑搶先改動它）；這裡仍用條件式 updateMany 而不是無條件 update，
      // 若真的出現非預期的 0 rows（狀態不變量被打破），寧可整個 transaction 回滾也不要
      // 留下「lottery 已 completed 但 item 沒有轉 reserved」的不一致資料。
      const itemUpdated = await tx.item.updateMany({
        where: { id: lottery.itemId, status: "published" },
        data: { status: "reserved" },
      });
      if (itemUpdated.count === 0) {
        throw new Error("LOTTERY_ITEM_STATE_INVARIANT_VIOLATED");
      }
      await tx.itemStatusLog.create({
        data: {
          itemId: lottery.itemId,
          fromStatus: "published",
          toStatus: "reserved",
          actorId: user.id,
        },
      });

      // 見檔案頂端註解：借用 ClaimComment 讓既有交接流程認得出這位接手者。
      await tx.claimComment.create({
        data: {
          itemId: lottery.itemId,
          userId: user.id,
          message: "（系統抽籤中選，非留言）",
          status: "accepted",
        },
      });

      await tx.lotteryAuditLog.create({
        data: {
          lotteryId,
          action: "rank_confirmed",
          actorId: user.id,
          metadata: { rank: result.rank },
        },
      });
      await tx.lotteryAuditLog.create({
        data: { lotteryId, action: "item_reserved", actorId: user.id },
      });

      return "completed" as const;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "LOTTERY_ITEM_STATE_INVARIANT_VIOLATED") {
      return jsonError("CONFLICT", "物品狀態異常，請聯絡客服");
    }
    throw e;
  }

  if (outcome === "conflict") {
    return jsonError("CONFLICT", "確認時間已過期或已被處理，請重新整理頁面");
  }

  return NextResponse.json({ id: lotteryId, status: outcome });
}
