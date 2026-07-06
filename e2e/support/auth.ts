import { randomBytes, randomUUID } from "node:crypto";
import { SESSION_COOKIE_NAME } from "./constants";
import { db } from "./db";

// 測試帳號一律用這個 email 網域，方便最後一次清乾淨（見 cleanupTestData）。
export const TEST_EMAIL_DOMAIN = "e2e.sharegood.test";

export { SESSION_COOKIE_NAME };

export type TestUser = {
  id: string;
  email: string;
  nickname: string;
  sessionToken: string;
};

/**
 * 建立一個「已完成 onboarding」的測試使用者（User + Profile），並直接在 sessions
 * 資料表塞一筆有效的 session（bypass Google OAuth）。這是 Auth.js database session
 * 策略下唯一乾淨的測試登入方式：專案沒有另外做測試專用登入端點，直接插 session row、
 * 帶對應的 cookie 打 API／瀏覽器，效果等同真的登入過。
 */
export async function createTestUser(opts: {
  label: string; // 用於 email 前綴與暱稱，方便從資料庫或測試輸出辨認
  cityId?: string | null;
}): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const email = `${opts.label}-${suffix}@${TEST_EMAIL_DOMAIN}`;
  const nickname = `${opts.label}${suffix}`.slice(0, 20);

  const user = await db.user.create({
    data: {
      email,
      name: nickname,
      profile: {
        create: {
          nickname,
          cityId: opts.cityId ?? null,
        },
      },
    },
  });

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 小時，測試跑完即過期
  await db.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  return { id: user.id, email, nickname, sessionToken };
}

/** Playwright/瀏覽器情境用的 cookie 物件。 */
export function sessionCookie(user: TestUser, opts: { domain: string; path?: string }) {
  return {
    name: SESSION_COOKIE_NAME,
    value: user.sessionToken,
    domain: opts.domain,
    path: opts.path ?? "/",
  };
}

/** fetch 呼叫 API 時要帶的 Cookie header 值。 */
export function sessionCookieHeader(user: TestUser): string {
  return `${SESSION_COOKIE_NAME}=${user.sessionToken}`;
}

/**
 * 刪掉這次測試建立的所有資料。刻意先刪 Item（cascade 掉 item_images／claim_comments／
 * direct_shares／handover_records／thanks_messages／conversations 等關聯列）與
 * SupportTicket（cascade 掉 support_ticket_events／support_ticket_attachments，
 * M2 使用者回報功能新增），再刪這批使用者上傳的 StorageObject（Item／SupportTicket
 * 都沒有 onDelete cascade 到 StorageObject 本身，需要另外清；SupportTicketAttachment
 * 對 StorageObject 是 onDelete: Restrict，所以必須先讓上面的 SupportTicket 連帶刪掉
 * attachment 列，不然這裡刪 StorageObject 會被外鍵擋下），最後刪 User（cascade 掉
 * sessions/profiles/roles/notifications/conversation_members/messages/
 * contribution_events 等其餘關聯）。
 */
export async function cleanupTestData(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.item.deleteMany({ where: { ownerId: { in: userIds } } });
  await db.supportTicket.deleteMany({ where: { userId: { in: userIds } } });
  await db.storageObject.deleteMany({ where: { uploaderId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

/** 保險用：依 email 網域整批清除（例如某次測試中途失敗、忘了個別 cleanup 時）。 */
export async function cleanupAllTestUsers(): Promise<number> {
  const testUsers = await db.user.findMany({
    where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  await cleanupTestData(testUsers.map((u) => u.id));
  return testUsers.length;
}
