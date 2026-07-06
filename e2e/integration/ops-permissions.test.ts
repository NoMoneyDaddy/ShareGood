import { afterAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, grantRole, type TestUser } from "../support/auth";

// master-plan §8a 驗收清單：
// 「/admin/ops 四個分頁（總覽／Storage／慢查詢／通知）皆能正常呈現資料；非
// admin/moderator 帳號存取 /admin/ops 或其對應 API → 403」。
//
// 這裡只驗證 API 層（`/api/admin/ops/*`）的權限邊界：未登入 401、登入但無
// moderator/admin 角色 403、moderator／admin 都能看到 200。頁面層（`/admin/ops/*`）
// 沿用既有 `/admin/support-tickets` 的慣例回 404（不透露頁面存在，見
// `src/app/admin/ops/require-ops-access.ts` 的說明），跟這裡驗證的 API 403 是不同層次、
// 刻意不同狀態碼，不在這支測試重複驗證頁面渲染本身。
//
// 另外驗證四支 job route（`storage_usage_snapshot`／`health_check_probe`／
// `notification_retry`／`ops_retention_cleanup`）沿用既有 CRON_SECRET 驗證慣例，缺少或
// 錯誤 token 一律 401。
const OPS_API_PATHS = [
  "/api/admin/ops/health",
  "/api/admin/ops/storage",
  "/api/admin/ops/performance",
  "/api/admin/ops/performance/slow",
  "/api/admin/ops/errors",
  "/api/admin/ops/notifications",
];

const JOB_PATHS = [
  "/api/jobs/storage-usage-snapshot",
  "/api/jobs/health-check-probe",
  "/api/jobs/notification-retry",
  "/api/jobs/ops-retention-cleanup",
];

describe("M8 營運儀表板 API 權限邊界", () => {
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupTestData(userIds);
  });

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  for (const path of OPS_API_PATHS) {
    it(`GET ${path} 未登入 → 401`, async () => {
      const res = await api(path);
      expect(res.status).toBe(401);
      expect((res.json as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
    });

    it(`GET ${path} 一般使用者（無 moderator/admin 角色）→ 403`, async () => {
      const plain = await user(`ops-perm-plain-${path.replace(/\W/g, "-")}`);
      const res = await api(path, { user: plain });
      expect(res.status).toBe(403);
      expect((res.json as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    });

    it(`GET ${path} moderator → 200`, async () => {
      const moderator = await user(`ops-perm-mod-${path.replace(/\W/g, "-")}`);
      await grantRole(moderator.id, "moderator");
      const res = await api(path, { user: moderator });
      expect(res.status).toBe(200);
    });

    it(`GET ${path} admin → 200`, async () => {
      const admin = await user(`ops-perm-admin-${path.replace(/\W/g, "-")}`);
      await grantRole(admin.id, "admin");
      const res = await api(path, { user: admin });
      expect(res.status).toBe(200);
    });
  }

  for (const path of JOB_PATHS) {
    it(`POST ${path} 缺少／錯誤 CRON_SECRET → 401`, async () => {
      const missing = await fetch(`${BASE_URL}${path}`, { method: "POST" });
      expect(missing.status).toBe(401);

      const wrong = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      });
      expect(wrong.status).toBe(401);
    });
  }
});
