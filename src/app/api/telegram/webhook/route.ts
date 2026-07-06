import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

// Telegram 官方文件（core.telegram.org/bots/api#setwebhook）：setWebhook 的 secret_token
// 設定後，Telegram 之後每次呼叫 webhook 都會帶 `X-Telegram-Bot-Api-Secret-Token` header，
// 用來讓我們的伺服器驗證這個請求真的來自 Telegram（而不是任何人猜到 webhook URL 就能打）。
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** 常數時間比對，避免 timing attack 猜出 secret（即使機率很低，這是安全底線該有的習慣）。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

type TelegramUpdatePayload = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number | string };
    from?: { username?: string };
  };
};

// POST /api/telegram/webhook — 接收 Telegram Bot API 的 webhook 更新。
//
// 兩層驗證／保護：
// 1. secret header 驗證（見上）：不符直接拒收，不處理內容。
// 2. update_id 去重（TelegramUpdate.updateId 唯一）：Telegram 在沒收到我們 200 回應時會
//    重送同一個 update，先把 updateId 存進去，違反 unique constraint 就代表已經處理過，
//    直接回 200（讓 Telegram 別再重送）但不重複處理內容。
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    // 設定缺失是我們自己的問題，不是呼叫方的錯，但也不能沒有驗證就照單全收——回 500 讓
    // 我們自己從監控發現「webhook secret 沒設定」，而不是悄悄地讓任何人都能打這支 API。
    return jsonError("INTERNAL", "TELEGRAM_WEBHOOK_SECRET 未設定");
  }

  const headerSecret = req.headers.get(SECRET_HEADER);
  if (!headerSecret || !safeEqual(headerSecret, secret)) {
    return jsonError("FORBIDDEN", "webhook secret 驗證失敗");
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdatePayload | null;
  if (!update || typeof update.update_id !== "number") {
    return jsonError("BAD_REQUEST", "update 格式錯誤");
  }

  const updateId = BigInt(update.update_id);

  try {
    await db.telegramUpdate.create({ data: { updateId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // 已經處理過的 update_id：直接回 200，不重複處理內容。
      return NextResponse.json({ ok: true, duplicate: true });
    }
    throw e;
  }

  // 內容處理失敗不該讓 Telegram 誤以為我們沒收到而一直重送同一個 update（update_id 已經
  // 記錄去重了），所以這裡吞掉例外只記 log，仍回 200；processedAt 維持 null 代表「收到了
  // 但處理時出過錯」，方便之後從紀錄追查。
  try {
    await processTelegramUpdate(update);
    await db.telegramUpdate.updateMany({ where: { updateId }, data: { processedAt: new Date() } });
  } catch (e) {
    console.error("處理 Telegram webhook update 失敗", updateId, e);
  }

  return NextResponse.json({ ok: true });
}

async function processTelegramUpdate(update: TelegramUpdatePayload): Promise<void> {
  const message = update.message;
  const text = message?.text?.trim();
  const chatIdRaw = message?.chat?.id;
  if (!text || chatIdRaw === undefined) return;

  const match = /^\/start(?:@\S+)?(?:\s+(\S+))?/.exec(text);
  if (!match) return; // 只處理 /start（含深連結帶 token 的情況），其他訊息目前不回應

  const chatId = String(chatIdRaw);
  const token = match[1];

  if (!token) {
    await sendTelegramMessage(
      chatId,
      "請透過 ShareGood 網站上的「綁定 Telegram」按鈕取得專屬連結。",
    );
    return;
  }

  await handleStartWithToken({ chatId, token, username: message?.from?.username });
}

async function handleStartWithToken(opts: {
  chatId: string;
  token: string;
  username?: string;
}): Promise<void> {
  const { chatId, token, username } = opts;

  const linkToken = await db.telegramLinkToken.findUnique({ where: { token } });
  const now = new Date();
  if (!linkToken || linkToken.consumedAt || linkToken.expiresAt < now) {
    await sendTelegramMessage(chatId, "綁定連結無效或已過期，請重新到網站產生新的綁定連結。");
    return;
  }

  try {
    const bound = await db.$transaction(async (tx) => {
      // updateMany + count 判斷同一個 token 只會被消費一次（比照 handover complete 那支的
      // 原子搶佔模式），避免同一個 update 因為某種原因被處理兩次時重複綁定。
      const consumed = await tx.telegramLinkToken.updateMany({
        where: { id: linkToken.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;

      await tx.telegramAccount.upsert({
        where: { userId: linkToken.userId },
        create: {
          userId: linkToken.userId,
          telegramChatId: chatId,
          telegramUsername: username ?? null,
        },
        update: {
          telegramChatId: chatId,
          telegramUsername: username ?? null,
          isActive: true,
          linkedAt: now,
          unlinkedAt: null,
        },
      });
      return true;
    });

    if (!bound) return; // token 已被消費過（併發或重送），安靜結束，不重複回覆
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // telegramChatId 唯一：這個 Telegram 帳號已經綁到別的 ShareGood 帳號。
      await sendTelegramMessage(
        chatId,
        "這個 Telegram 帳號已經綁定其他 ShareGood 帳號，請先在原帳號解除綁定後再試一次。",
      );
      return;
    }
    throw e;
  }

  // 示範/驗證用呼叫點：綁定成功後回覆確認訊息，證明 sendTelegramMessage 介面能動
  // （沒有真的 Bot Token 時會走進 helper 的失敗分支，不會讓整支 webhook 崩潰）。
  await sendTelegramMessage(chatId, "綁定成功！之後有新的留言、直贈或交接通知，我會傳訊息到這裡。");
}
