import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkUserRestriction } from "@/lib/restrictions";

// POST /api/items/[id]/lottery/entries — 報名參加抽籤（master-plan §5a 交付內容 3）。
// 報名的性質跟「留言表達想要這個物品」很接近，沿用既有 `checkUserRestriction(..., "claiming")`
// 而不是另外發明一個限制類型。
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  const restriction = await checkUserRestriction(user.id, "claiming");
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const { id: itemId } = await params;
  const item = await db.item.findUnique({
    where: { id: itemId },
    select: { id: true, ownerId: true },
  });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId === user.id) {
    return jsonError("CONFLICT", "不能報名自己分享的物品抽籤");
  }

  const lottery = await db.lottery.findUnique({
    where: { itemId },
    select: { id: true, status: true, entryDeadline: true },
  });
  if (!lottery) return jsonError("NOT_FOUND", "這個物品目前沒有開放的抽籤");
  if (lottery.status !== "open" || lottery.entryDeadline.getTime() <= Date.now()) {
    return jsonError("CONFLICT", "這場抽籤已經截止報名");
  }

  const now = new Date();

  try {
    const existing = await db.lotteryEntry.findUnique({
      where: { lotteryId_userId: { lotteryId: lottery.id, userId: user.id } },
    });

    let entryId: string;
    if (existing) {
      if (existing.status === "entered") {
        return jsonError("CONFLICT", "你已經報名過了");
      }
      // 取消過又想重新報名：因為 (lotteryId, userId) 唯一，重新報名等同於把既有那一列從
      // cancelled 改回 entered（見規格「報名與取消報名 API」）。
      const updated = await db.lotteryEntry.update({
        where: { id: existing.id },
        data: { status: "entered", enteredAt: now, cancelledAt: null },
        select: { id: true },
      });
      entryId = updated.id;
    } else {
      const created = await db.lotteryEntry.create({
        data: { lotteryId: lottery.id, userId: user.id, status: "entered" },
        select: { id: true },
      });
      entryId = created.id;
    }

    await db.lotteryAuditLog.create({
      data: {
        lotteryId: lottery.id,
        action: "entry_created",
        actorId: user.id,
        metadata: { entryId },
      },
    });

    return NextResponse.json({ id: entryId }, { status: 201 });
  } catch (e) {
    // 兩個併發請求同時幫同一使用者建立第一筆報名：只有一個能 create 成功，
    // 另一個撞 (lotteryId, userId) 的 unique constraint。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError("CONFLICT", "你已經報名過了");
    }
    throw e;
  }
}

// DELETE /api/items/[id]/lottery/entries — 取消報名，僅限截止前（master-plan §5a 交付內容 3）。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;
  const lottery = await db.lottery.findUnique({
    where: { itemId },
    select: { id: true, status: true },
  });
  if (!lottery) return jsonError("NOT_FOUND", "這個物品目前沒有開放的抽籤");
  if (lottery.status !== "open") {
    return jsonError("CONFLICT", "這場抽籤已經截止，無法取消報名");
  }

  const now = new Date();
  const updated = await db.lotteryEntry.updateMany({
    where: { lotteryId: lottery.id, userId: user.id, status: "entered" },
    data: { status: "cancelled", cancelledAt: now },
  });
  if (updated.count === 0) {
    return jsonError("NOT_FOUND", "找不到你在這場抽籤的報名紀錄");
  }

  await db.lotteryAuditLog.create({
    data: { lotteryId: lottery.id, action: "entry_cancelled", actorId: user.id },
  });

  return NextResponse.json({ ok: true });
}
