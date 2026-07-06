import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { createOrMergeNotification } from "@/lib/notifications";
import { checkFullBlock } from "@/lib/restrictions";

// PATCH /api/lotteries/[id]/cancel — 物主取消整個抽籤（master-plan §5a 交付內容 3）。
// 僅限 status='open' 時可取消；已開獎後不可取消（對正在等待確認的候選人不公平）。
// 取消後該物品永久失去抽籤資格（lotteries.itemId 是 @unique，不會有第二筆）。
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
  const lottery = await db.lottery.findUnique({
    where: { id: lotteryId },
    include: { item: { select: { id: true, title: true } } },
  });
  if (!lottery) return jsonError("NOT_FOUND", "找不到這場抽籤");
  if (lottery.creatorId !== user.id) {
    return jsonError("FORBIDDEN", "只有物主可以取消這場抽籤");
  }
  if (lottery.status !== "open") {
    return jsonError("CONFLICT", "這場抽籤已經開獎或已結束，無法取消");
  }

  const updated = await db.lottery.updateMany({
    where: { id: lotteryId, status: "open" },
    data: { status: "cancelled" },
  });
  if (updated.count === 0) {
    return jsonError("CONFLICT", "這場抽籤已經開獎或已結束，無法取消");
  }

  await db.lotteryAuditLog.create({
    data: { lotteryId, action: "lottery_cancelled", actorId: user.id },
  });

  // 通知所有目前 entered 狀態的報名者：這個抽籤已被物主取消。
  const entrants = await db.lotteryEntry.findMany({
    where: { lotteryId, status: "entered" },
    select: { userId: true },
  });
  for (const entrant of entrants) {
    await createOrMergeNotification(db, {
      userId: entrant.userId,
      type: "completion_confirmed",
      payload: {
        itemId: lottery.item.id,
        itemTitle: lottery.item.title,
        kind: "lottery_cancelled",
      },
    });
  }

  return NextResponse.json({ id: lotteryId, status: "cancelled" });
}
