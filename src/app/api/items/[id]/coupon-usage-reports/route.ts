import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { CouponUsageResult } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkUserRestriction } from "@/lib/restrictions";

const VALID_RESULTS = new Set<string>(Object.values(CouponUsageResult));

// POST /api/items/[id]/coupon-usage-reports — 優惠券「使用結果回報」（master-plan §9a
// 交付內容 3）：只有接手者能回報，一人一券一次。權限判斷比照既有
// /api/items/[id]/coupon/reveal 的做法——receiver 身分一律以 HandoverRecord.receiverId
// 為準，物品狀態需在 handover_pending（交接進行中）或 completed（已完成）——理由相同：
// 交接還沒確定就回報「可用/失效」沒有意義，也還沒有明確的接手者。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被禁止留言/認領或被全站封鎖的使用者不能回報
  // （沒有專屬的 restriction type，借用跟認領同一組 no_claiming，理由：使用回報是接手者
  // 身分才能做的動作，跟認領屬於同一類互動）。
  const restriction = await checkUserRestriction(user.id, "claiming");
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  const body = await req.json().catch(() => null);
  const result = typeof body?.result === "string" ? body.result : "";
  if (!VALID_RESULTS.has(result)) {
    return jsonError("UNPROCESSABLE", "請選擇回報結果：可用或已失效");
  }

  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { handoverRecord: true, couponDetail: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (!item.couponDetail) return jsonError("NOT_FOUND", "這個物品不是優惠券");

  if (item.status !== "handover_pending" && item.status !== "completed") {
    return jsonError("CONFLICT", "交接尚未確定，還不能回報使用結果");
  }
  if (!item.handoverRecord || item.handoverRecord.receiverId !== user.id) {
    return jsonError("FORBIDDEN", "只有接手者可以回報使用結果");
  }

  try {
    const report = await db.couponUsageReport.create({
      data: { itemId, reporterId: user.id, result: result as CouponUsageResult },
    });
    return NextResponse.json(
      { id: report.id, result: report.result, createdAt: report.createdAt },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "你已經回報過這張券的使用結果了");
    }
    throw e;
  }
}

// GET /api/items/[id]/coupon-usage-reports — 公開聚合統計（可用／已失效各幾人回報）。
// 任何人（含未登入）都能在物品詳情頁看到這組統計數字，跟留言數／感謝留言一樣是公開資訊；
// 個別回報者身分不對外公開。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: itemId } = await params;

  const grouped = await db.couponUsageReport.groupBy({
    by: ["result"],
    where: { itemId },
    _count: { _all: true },
  });

  const counts: Record<CouponUsageResult, number> = { usable: 0, expired_or_used: 0 };
  for (const row of grouped) {
    counts[row.result] = row._count._all;
  }

  return NextResponse.json(counts);
}
