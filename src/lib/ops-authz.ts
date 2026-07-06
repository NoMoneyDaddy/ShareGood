import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";

// `/api/admin/ops/*`（master-plan §8a 交付內容 7）共用的權限檢查：moderator/admin 才能
// 存取，其餘一律 401/403，沿用既有 `requireRole` 機制（見 `/api/admin/support-tickets`
// 既有慣例）。這裡把「try/catch AuthzError 轉成 jsonError response」抽成共用 helper，
// 避免 6 支 ops API route 各自重複同一段樣板。
//
// 用「拋出 Response、呼叫端 catch 起來直接回傳」而不是回傳 discriminated union，是為了讓
// 呼叫端只要一行 `catch (e) { if (e instanceof Response) return e; throw e; }` 就能處理，
// 不需要每次都手動檢查回傳值的形狀。
export async function requireOpsAccess() {
  try {
    return await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      throw jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }
}
