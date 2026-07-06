import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// Telegram Bot 相關數值集中管理（比照 M1 `src/lib/contribution.ts`「數值進 config 不寫死」的慣例）。
export const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 10;
const SEND_MESSAGE_TIMEOUT_MS = 5_000;

/**
 * 產生一次性綁定 token。用 base64url（Telegram 深連結 start 參數只允許
 * `[A-Za-z0-9_-]`，長度 1–64）避免額外編碼；32 bytes 隨機碼編碼後約 43 字元，遠低於上限。
 */
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 組出 Telegram 深連結：`https://t.me/<bot_username>?start=<token>`。 */
export function buildTelegramDeepLink(token: string): string {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    throw new Error("TELEGRAM_BOT_USERNAME 未設定，無法組出 Telegram 深連結");
  }
  return `https://t.me/${botUsername}?start=${token}`;
}

// Telegram sendMessage 失敗時，若錯誤訊息符合這些特徵，代表使用者已經封鎖 bot 或刪除對話，
// 判定帳號已失效、應自動解綁（master-plan §9 交付內容 3／§8a 交付內容 6 的精神，此處先落地
// 「送訊息當下就判斷」的簡化版——單次符合就立刻解綁，比 §8a 規格描述的「連續 3 筆都符合」
// 更早出手，是既有邏輯的合理超集，不修改）。
//
// M8（`src/lib/notification-retry.ts`）另外實作規格明文要求的「連續 N 筆 delivery 都失敗
// 且符合特徵」判定，當作這裡的備援：萬一某次失敗沒有經過 `sendTelegramMessage`（理論上
// 不會發生，因為重送 job 就是呼叫這支函式）或未來新增其他發送路徑忘記接上這支即時判斷，
// 重送 job 的獨立掃描仍能在下一輪把帳號解綁。兩者都是 idempotent 的
// `updateMany({ where: { isActive: true } })`，重複觸發不會出錯，故意保留這層重疊。
export const DEACTIVATE_ON_ERROR_PATTERNS = [
  /blocked/i,
  /chat not found/i,
  /user is deactivated/i,
  /kicked/i,
];

export type SendTelegramMessageResult =
  | { ok: true }
  | { ok: false; error: string; deactivated: boolean };

/**
 * 呼叫 Telegram Bot API 的 sendMessage 端點（純 fetch，不引入 bot 框架套件）。
 *
 * 這支任務沒有真的 Telegram Bot Token，這支 helper 沒辦法端到端驗證過（見 PR 說明）——
 * 因此錯誤處理刻意寫得保守：任何失敗（缺 token、逾時、非 2xx、網路錯誤）都只回傳結構化
 * 結果，不丟例外，呼叫端（webhook handler）不會因為這支呼叫失敗而整支請求跟著壞掉。
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<SendTelegramMessageResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN 未設定", deactivated: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_MESSAGE_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (res.ok && data?.ok) {
      return { ok: true };
    }

    const description = data?.description ?? `HTTP ${res.status}`;
    const deactivated = await deactivateIfAccountInvalid(chatId, description);
    return { ok: false, error: description, deactivated };
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知錯誤";
    return { ok: false, error: message, deactivated: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function deactivateIfAccountInvalid(
  chatId: string,
  errorDescription: string,
): Promise<boolean> {
  const matched = DEACTIVATE_ON_ERROR_PATTERNS.some((pattern) => pattern.test(errorDescription));
  if (!matched) return false;

  const result = await db.telegramAccount.updateMany({
    where: { telegramChatId: chatId, isActive: true },
    data: { isActive: false, unlinkedAt: new Date() },
  });
  return result.count > 0;
}
