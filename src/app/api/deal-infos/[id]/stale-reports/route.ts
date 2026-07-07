import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { getCurrentDealInfoRound, getDealStaleThreshold } from "@/lib/deal-info";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/deal-infos/[id]/stale-reports — 失效回報（master-plan §9a 交付內容 1，
// 借鏡 hotukdeals 多人回報＋狀態可逆）。登入使用者對 published 的 DealInfo 回報一次
// 「已失效」；同一輪內不重複的回報人數達門檻（DEAL_STALE_THRESHOLD，見
// src/lib/deal-info.ts）就自動轉 stale。同一人同一輪重複回報靠 unique(dealInfoId,
// reporterId, round) 擋下（P2002 → 409），不計入累計人數。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const blocked = await checkFullBlock(user.id);
  if (blocked.blocked) return jsonError("FORBIDDEN", blocked.message);

  try {
    await checkRateLimit(user.id, "deal_info_report_create");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  const { id } = await params;
  const dealInfo = await db.dealInfo.findUnique({ where: { id }, select: { status: true } });
  if (!dealInfo) return jsonError("NOT_FOUND", "找不到這則好康資訊");
  if (dealInfo.status !== DealInfoStatus.published) {
    return jsonError("CONFLICT", "只能對上架中的好康資訊回報失效");
  }

  const round = await getCurrentDealInfoRound(id);
  const threshold = getDealStaleThreshold();

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.dealInfoReport.create({ data: { dealInfoId: id, reporterId: user.id, round } });

      if (threshold === null) return { becameStale: false };

      // 同一輪內每人恰好一列（unique 保證），COUNT(*) 就等於「這輪不重複回報人數」。
      const reportCount = await tx.dealInfoReport.count({ where: { dealInfoId: id, round } });
      if (reportCount < threshold) return { becameStale: false };

      // updateMany 帶 status: published 條件當樂觀鎖：避免這筆回報跟另一個「同時」達門檻的
      // 回報請求、或 moderator 手動觸發的動作互相覆蓋（例如剛好同時被硬性 TTL job 轉
      // expired）。count 0 代表已經被別的請求轉走，不算失敗，仍視為回報本身成功。
      const flipped = await tx.dealInfo.updateMany({
        where: { id, status: DealInfoStatus.published },
        data: { status: DealInfoStatus.stale, staleReportedAt: new Date() },
      });
      return { becameStale: flipped.count === 1 };
    });

    return NextResponse.json({ round, becameStale: result.becameStale });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "您已經回報過了");
    }
    throw e;
  }
}
