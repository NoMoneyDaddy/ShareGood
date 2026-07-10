import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// 公開個人頁 /u/[userId]（src/app/(shell)/u/[userId]/page.tsx）：getProfile 查詢帶
// `deletedAt: null` 條件（M7 帳號去識別化後不應再公開展示個人統計），查不到就
// notFound()。這裡直接打正在跑的 dev server 驗證 HTTP 狀態碼，不 mock 任何東西。
describe("GET /u/[userId]：公開個人頁", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string) {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  it("正常帳號回 200，且顯示暱稱", async () => {
    const u = await user("profile-page-normal");
    const res = await fetch(`${BASE_URL}/u/${u.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(u.nickname);
  });

  it("已去識別化帳號（deletedAt 非 null）回 404", async () => {
    const u = await user("profile-page-deleted");
    await db.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });

    const res = await fetch(`${BASE_URL}/u/${u.id}`);
    expect(res.status).toBe(404);
  });

  it("不存在的 userId 回 404", async () => {
    const res = await fetch(`${BASE_URL}/u/does-not-exist-${Date.now()}`);
    expect(res.status).toBe(404);
  });
});
