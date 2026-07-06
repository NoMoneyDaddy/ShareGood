import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  buildTelegramDeepLink,
  generateLinkToken,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
} from "@/lib/telegram";

// POST /api/telegram/link-token — 登入使用者產生一次性 Telegram 綁定 token。
//
// token 存進 TelegramLinkToken（10 分鐘有效期），回傳一個 Telegram 深連結
// （`https://t.me/<bot_username>?start=<token>`）；使用者在 Telegram 點開連結、bot 收到
// `/start <token>` 後由 webhook（/api/telegram/webhook）驗證並完成綁定。
export async function POST() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const token = generateLinkToken();
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.telegramLinkToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  let deepLink: string;
  try {
    deepLink = buildTelegramDeepLink(token);
  } catch (e) {
    // TELEGRAM_BOT_USERNAME 沒設定：設定缺失是伺服器端問題，不該讓使用者看到 500 卻毫無頭緒。
    const message = e instanceof Error ? e.message : "無法產生 Telegram 深連結";
    return jsonError("INTERNAL", message);
  }

  return NextResponse.json({ token, deepLink, expiresAt }, { status: 201 });
}
