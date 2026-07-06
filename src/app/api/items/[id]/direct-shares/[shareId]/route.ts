import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// PATCH /api/items/[id]/direct-shares/[shareId] — receiver 接受或婉拒直贈邀請。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
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

  const { id: itemId, shareId } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "accept" && action !== "decline") {
    return jsonError("UNPROCESSABLE", "action 必須是 accept 或 decline");
  }

  const share = await db.directShare.findUnique({ where: { id: shareId } });
  if (!share || share.itemId !== itemId) return jsonError("NOT_FOUND", "找不到這筆直贈邀請");
  if (share.receiverId !== user.id) {
    return jsonError("FORBIDDEN", "只有受贈者可以回應這筆直贈邀請");
  }

  // Lazy expiry：任何操作前先確認這筆 pending 直贈是否已經過期，過期就地轉成 expired
  // 再走後續邏輯（M1 MVP 簡化，不搭背景 job，理由見 PR 說明）。
  let status = share.status;
  if (status === "pending" && share.expiresAt < new Date()) {
    await db.directShare.update({ where: { id: share.id }, data: { status: "expired" } });
    status = "expired";
  }
  if (status !== "pending") {
    return jsonError("UNPROCESSABLE", "已逾期");
  }

  const now = new Date();

  if (action === "decline") {
    await db.directShare.update({
      where: { id: share.id },
      data: { status: "declined", respondedAt: now },
    });
    return NextResponse.json({ status: "declined" });
  }

  // accept：物品狀態轉換要跟留言/認領那邊比照同一套原子搶佔模式，因為理論上兩邊
  // 可能同時把同一個物品搶走。
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.item.updateMany({
      where: { id: itemId, status: "published" },
      data: { status: "reserved" },
    });
    if (updated.count === 0) {
      await tx.directShare.update({
        where: { id: share.id },
        data: { status: "declined", respondedAt: now },
      });
      return { ok: false as const };
    }

    await tx.directShare.update({
      where: { id: share.id },
      data: { status: "accepted", respondedAt: now },
    });
    await tx.itemStatusLog.create({
      data: {
        itemId,
        fromStatus: "published",
        toStatus: "reserved",
        actorId: user.id,
      },
    });

    const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
    // enum 沒有專門給「直贈被接受」用的 NotificationType，重用 claim_accepted
    // （PR 裡有說明這個重用理由）。
    await tx.notification.create({
      data: {
        userId: item.ownerId,
        type: "claim_accepted",
        payload: {
          itemId,
          itemTitle: item.title,
          receiverId: user.id,
        },
      },
    });

    return { ok: true as const };
  });

  if (!result.ok) {
    return jsonError("CONFLICT", "這個物品已經不在了");
  }
  return NextResponse.json({ status: "accepted" });
}
