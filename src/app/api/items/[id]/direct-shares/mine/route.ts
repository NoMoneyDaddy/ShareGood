import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// GET /api/items/[id]/direct-shares/mine — 目前登入者在這個物品上的 pending 直贈邀請（沒有就回 null）。
// 給詳情頁的 DirectShareSection 用，判斷要不要顯示「你收到一份直接贈與」的接受/婉拒 UI。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id: itemId } = await params;
  const share = await db.directShare.findFirst({
    where: { itemId, receiverId: user.id, status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  if (!share) return NextResponse.json({ share: null });

  // Lazy expiry：讀取時順便檢查是否已過期，過期就地轉態，回傳給前端當作沒有 pending。
  if (share.expiresAt < new Date()) {
    await db.directShare.update({ where: { id: share.id }, data: { status: "expired" } });
    return NextResponse.json({ share: null });
  }

  return NextResponse.json({ share: { id: share.id, expiresAt: share.expiresAt } });
}
