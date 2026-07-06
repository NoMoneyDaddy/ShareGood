import { db } from "@/lib/db";

// ⚠️ 法律免責聲明：legal hold 的認定範圍與流程僅為技術實作參考，正式營運前需台灣律師與
// 平台法務審閱（見 master-plan.md §7a 節首聲明）。這個檔案只提供技術機制（保全查詢/批次
// 過濾），不做任何「這筆資料該不該被保全」的法律判斷。

/**
 * 單筆檢查：某個目標（例如某個 user／item／conversation）目前是否命中 active 的 legal hold。
 * 給「這筆資料本來就只有一筆」的情境用（例如帳號刪除 job 檢查單一 userId）；批次清理場景
 * 請改用 `filterUnderLegalHold`，避免逐筆查詢造成 N+1（見 master-plan §7a 交付內容 4 教訓）。
 */
export async function isUnderLegalHold(targetType: string, targetId: string): Promise<boolean> {
  const hit = await db.legalHoldTarget.findFirst({
    where: { targetType, targetId, legalHold: { status: "active" } },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * 批次檢查：給一批候選 id，回傳其中「目前被 active legal hold 命中」的 id 集合。
 * 用單一 `IN (...)` 查詢完成，不逐筆呼叫 `isUnderLegalHold`（那樣是 N+1，見
 * master-plan §7a 交付內容 4 對 retention_purge job 的明確要求）。
 */
export async function filterUnderLegalHold(
  targetType: string,
  targetIds: string[],
): Promise<Set<string>> {
  if (targetIds.length === 0) return new Set();
  const hits = await db.legalHoldTarget.findMany({
    where: { targetType, targetId: { in: targetIds }, legalHold: { status: "active" } },
    select: { targetId: true },
  });
  return new Set(hits.map((h) => h.targetId));
}
