import { afterAll, describe, expect, it } from "vitest";
import { api } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// master-plan §9 驗收清單：
// 「綁定→收到 TG 通知→解綁，全流程實跑」「偽造 webhook（錯 secret）→ 拒收；重放同
// update_id → 不重複處理」。
//
// 本機沒有真的 Telegram Bot Token，沒辦法端到端打真的 Telegram 服務；這裡改用手工建構的
// 假 webhook payload 直接打 /api/telegram/webhook，驗證「secret header 驗證」與
// 「update_id 去重」這兩項規格明文說明「可以用手工假 request 測試，不需要真的 Telegram
// 服務」的部分。sendTelegramMessage 呼叫本身因為 TELEGRAM_BOT_TOKEN 是假的，會走進
// helper 的失敗分支（見 src/lib/telegram.ts），但這不影響 webhook 處理邏輯本身的正確性。
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

let nextUpdateId = 900_000_000;
function freshUpdateId(): number {
  nextUpdateId += 1;
  return nextUpdateId;
}

function startUpdate(opts: { updateId: number; chatId: number; text: string; username?: string }) {
  return {
    update_id: opts.updateId,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId, type: "private" },
      from: { id: opts.chatId, is_bot: false, username: opts.username },
      text: opts.text,
    },
  };
}

describe("Telegram Bot 綁定與 webhook", () => {
  const userIds: string[] = [];
  const updateIds: bigint[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
    if (updateIds.length > 0) {
      await db.telegramUpdate.deleteMany({ where: { updateId: { in: updateIds } } });
    }
  });

  it("POST /api/telegram/link-token 未登入回 401", async () => {
    const res = await api("/api/telegram/link-token", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /api/telegram/link-token 登入後回傳一次性 token 與正確格式的深連結", async () => {
    const user = await createTestUser({ label: "tg-link" });
    userIds.push(user.id);

    const res = await api("/api/telegram/link-token", { method: "POST", user });
    expect(res.status).toBe(201);
    const body = res.json as { token: string; deepLink: string; expiresAt: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url，Telegram start 參數合法字元集
    expect(body.deepLink).toBe(
      `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${body.token}`,
    );

    const stored = await db.telegramLinkToken.findUnique({ where: { token: body.token } });
    expect(stored?.userId).toBe(user.id);
    expect(stored?.consumedAt).toBeNull();
    const minutesUntilExpiry = (new Date(body.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutesUntilExpiry).toBeGreaterThan(9);
    expect(minutesUntilExpiry).toBeLessThanOrEqual(10);
  });

  it("webhook 錯誤 secret 一律拒收，不建立 TelegramUpdate 紀錄", async () => {
    const updateId = freshUpdateId();
    const res = await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
      body: startUpdate({ updateId, chatId: 111, text: "/start whatever" }),
    });
    expect(res.status).toBe(403);

    const row = await db.telegramUpdate.findUnique({ where: { updateId: BigInt(updateId) } });
    expect(row).toBeNull();
  });

  it("webhook 完全沒帶 secret header 也拒收", async () => {
    const updateId = freshUpdateId();
    const res = await api("/api/telegram/webhook", {
      method: "POST",
      body: startUpdate({ updateId, chatId: 112, text: "/start whatever" }),
    });
    expect(res.status).toBe(403);
  });

  it("正確 secret + 有效 token 的 /start：建立 TelegramAccount、token 標記已消費", async () => {
    const user = await createTestUser({ label: "tg-bind" });
    userIds.push(user.id);

    const linkRes = await api("/api/telegram/link-token", { method: "POST", user });
    const { token } = linkRes.json as { token: string };

    const chatId = 20260706;
    const updateId = freshUpdateId();
    updateIds.push(BigInt(updateId));

    const res = await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: startUpdate({ updateId, chatId, text: `/start ${token}`, username: "tg_bind_test" }),
    });
    expect(res.status).toBe(200);

    const account = await db.telegramAccount.findUnique({ where: { userId: user.id } });
    expect(account?.telegramChatId).toBe(String(chatId));
    expect(account?.isActive).toBe(true);
    expect(account?.unlinkedAt).toBeNull();

    const consumedToken = await db.telegramLinkToken.findUnique({ where: { token } });
    expect(consumedToken?.consumedAt).not.toBeNull();

    const updateRow = await db.telegramUpdate.findUnique({ where: { updateId: BigInt(updateId) } });
    expect(updateRow?.processedAt).not.toBeNull();
  });

  it("重放同一個 update_id 不重複處理（第二次回 duplicate，不二次消費 token）", async () => {
    const user = await createTestUser({ label: "tg-replay" });
    userIds.push(user.id);

    const linkRes = await api("/api/telegram/link-token", { method: "POST", user });
    const { token } = linkRes.json as { token: string };

    const chatId = 20260707;
    const updateId = freshUpdateId();
    updateIds.push(BigInt(updateId));
    const payload = startUpdate({ updateId, chatId, text: `/start ${token}` });

    const first = await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: payload,
    });
    expect(first.status).toBe(200);
    expect((first.json as { duplicate?: boolean }).duplicate).toBeUndefined();

    const second = await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: payload,
    });
    expect(second.status).toBe(200);
    expect((second.json as { duplicate?: boolean }).duplicate).toBe(true);

    // 重放不該讓同一筆帳號被重複綁定或狀態被改寫；只會有一個 TelegramAccount。
    const accounts = await db.telegramAccount.findMany({ where: { userId: user.id } });
    expect(accounts).toHaveLength(1);
  });

  it("token 過期或無效：不建立 TelegramAccount", async () => {
    const chatId = 20260708;
    const updateId = freshUpdateId();
    updateIds.push(BigInt(updateId));

    const res = await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: startUpdate({ updateId, chatId, text: "/start this-token-does-not-exist" }),
    });
    expect(res.status).toBe(200); // webhook 對 Telegram 一律回 200，錯誤原因不影響回應碼

    const account = await db.telegramAccount.findUnique({
      where: { telegramChatId: String(chatId) },
    });
    expect(account).toBeNull();
  });

  it("DELETE /api/telegram/account：綁定後可解綁，解綁後查無帳號、重複解綁回 404", async () => {
    const user = await createTestUser({ label: "tg-unlink" });
    userIds.push(user.id);

    const linkRes = await api("/api/telegram/link-token", { method: "POST", user });
    const { token } = linkRes.json as { token: string };
    const chatId = 20260709;
    const updateId = freshUpdateId();
    updateIds.push(BigInt(updateId));

    await api("/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET },
      body: startUpdate({ updateId, chatId, text: `/start ${token}` }),
    });
    expect(await db.telegramAccount.findUnique({ where: { userId: user.id } })).not.toBeNull();

    const del = await api("/api/telegram/account", { method: "DELETE", user });
    expect(del.status).toBe(200);
    expect(await db.telegramAccount.findUnique({ where: { userId: user.id } })).toBeNull();

    const delAgain = await api("/api/telegram/account", { method: "DELETE", user });
    expect(delAgain.status).toBe(404);
  });

  it("DELETE /api/telegram/account 未登入回 401", async () => {
    const res = await api("/api/telegram/account", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
