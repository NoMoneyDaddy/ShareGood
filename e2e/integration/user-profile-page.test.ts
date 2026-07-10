import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";

// 公開個人頁 /u/[userId]（src/app/(shell)/u/[userId]/page.tsx）：M7 帳號刪除是應用層
// 去識別化（User 列保留、nickname 改寫為「已刪除的使用者」），個人頁仍回 200 顯示匿名化
// 頁面（維持歷史紀錄完整性，見 data-rights.test.ts 的既有驗收）。這裡直接打正在跑的
// dev server 驗證 HTTP 狀態碼，不 mock 任何東西。
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

  it("已去識別化帳號（deletedAt 非 null）仍回 200 並顯示匿名暱稱（M7 保留匿名歷史）", async () => {
    const u = await user("profile-page-deleted");
    // 模擬 M7 去識別化後的狀態：deletedAt 非 null＋nickname 改寫為「已刪除的使用者」。
    await db.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    await db.profile.update({ where: { userId: u.id }, data: { nickname: "已刪除的使用者" } });

    const res = await fetch(`${BASE_URL}/u/${u.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("已刪除的使用者");
    expect(html).not.toContain(u.nickname);
  });

  it("不存在的 userId 回 404", async () => {
    const res = await fetch(`${BASE_URL}/u/does-not-exist-${Date.now()}`);
    expect(res.status).toBe(404);
  });
});
