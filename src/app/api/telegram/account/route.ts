import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

// DELETE /api/telegram/account — 使用者主動解綁 Telegram。
//
// 與「失效自動解綁」（isActive=false + unlinkedAt，見 src/lib/telegram.ts）不同：這裡是
// 使用者自己要求斷開，直接刪掉整筆 TelegramAccount（不留 chatId），若之後想重新綁定，
// 走 /api/telegram/link-token 重新產生 token 走一次綁定流程即可（unique(userId) /
// unique(telegramChatId) 都不會因為舊紀錄殘留而衝突）。
export async function DELETE() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const deleted = await db.telegramAccount.deleteMany({ where: { userId: user.id } });
  if (deleted.count === 0) {
    return jsonError("NOT_FOUND", "目前沒有綁定 Telegram 帳號");
  }

  return NextResponse.json({ ok: true });
}
