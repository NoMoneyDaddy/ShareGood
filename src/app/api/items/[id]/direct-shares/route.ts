import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const DIRECT_SHARE_TTL_MS = 72 * 60 * 60 * 1000; // 72 小時

// POST /api/items/[id]/direct-shares — 物主直接指定某使用者贈與（M1：直贈）。
// MVP 簡化：目前沒有使用者搜尋 UI，用「輸入對方 email」解析成 userId；
// 同一物品同時間只允許一筆 pending 直贈，避免物主亂發邀請造成混亂。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id: itemId } = await params;
  const item = await db.item.findUnique({ where: { id: itemId } });
  if (!item) return jsonError("NOT_FOUND", "找不到這個物品");
  if (item.ownerId !== user.id) return jsonError("FORBIDDEN", "只有物主可以贈與這個物品");
  if (item.status !== "published") {
    return jsonError("CONFLICT", "這個物品目前無法贈與");
  }

  const body = await req.json().catch(() => null);
  const receiverEmail = typeof body?.receiverEmail === "string" ? body.receiverEmail.trim() : "";
  if (!receiverEmail) {
    return jsonError("UNPROCESSABLE", "請輸入對方 email");
  }
  if (receiverEmail.toLowerCase() === user.email.toLowerCase()) {
    return jsonError("UNPROCESSABLE", "不能贈送給自己");
  }

  const receiver = await db.user.findUnique({ where: { email: receiverEmail } });
  if (!receiver) {
    return jsonError("UNPROCESSABLE", "找不到這個使用者");
  }

  const existingPending = await db.directShare.findFirst({
    where: { itemId, status: "pending" },
  });
  if (existingPending) {
    return jsonError("CONFLICT", "已經有一筆進行中的直贈邀請");
  }

  const now = new Date();
  const created = await db.directShare.create({
    data: {
      itemId,
      receiverId: receiver.id,
      status: "pending",
      expiresAt: new Date(now.getTime() + DIRECT_SHARE_TTL_MS),
    },
  });

  await db.notification.create({
    data: {
      userId: receiver.id,
      type: "direct_share_received",
      payload: {
        itemId: item.id,
        itemTitle: item.title,
        itemOwnerNickname: user.profile.nickname,
      },
    },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
