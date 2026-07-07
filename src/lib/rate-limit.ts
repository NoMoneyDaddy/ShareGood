import { db } from "@/lib/db";

// M2 治理底線（master-plan.md §7）：rate limit 起步版——不新增表，直接對既有表
// （Item/ClaimComment/Message/Report/StorageObject）用 createdAt 時間窗 COUNT(*)，
// 完全不動 schema。缺點是每次檢查都要下一次查詢，但這幾張表都已經有可用的欄位可查，
// 量體在 M2 這個階段可接受；之後真的要換 Redis-based 令牌桶，把 checkRateLimit 的
// 實作換掉即可，呼叫端不必改。

export type RateLimitAction =
  | "item_create"
  | "claim_create"
  | "message_create"
  | "upload_create"
  | "report_create"
  | "deal_info_create"
  | "deal_info_report_create";

// 數值集中放這裡，之後要調整不用去改各支 API。比照 src/lib/contribution.ts 的慣例。
// 注意 upload_create：一次 POST /api/uploads 會建立 2 筆 StorageObject（thumb+medium），
// 所以這裡的門檻是「實際上傳次數 × 2」，例如 hourly 60 代表使用者一小時最多上傳 30 次檔案。
export const RATE_LIMITS: Record<RateLimitAction, { hourly: number; daily: number }> = {
  item_create: { hourly: 5, daily: 20 },
  claim_create: { hourly: 20, daily: 100 },
  message_create: { hourly: 60, daily: 300 },
  upload_create: { hourly: 60, daily: 300 },
  report_create: { hourly: 10, daily: 30 },
  // M9（master-plan §9a 交付內容 1）：DealInfo 投稿頻率上限，比照 item_create 但稍寬鬆——
  // moderator/admin 人工收錄 S1 來源時常一次建立好幾筆（例如初次把 10 個種子來源各自對應
  // 一則好康），5/hour 會誤傷正常的編輯作業，數值為工程判斷，非規格明文（規格本身沒有給
  // 這個動作的精確數字，只要求「新增 mutation 端點一律套用 rate limit」）。
  deal_info_create: { hourly: 10, daily: 40 },
  deal_info_report_create: { hourly: 10, daily: 30 },
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Counter = (userId: string, since: Date) => Promise<number>;

// 各動作對應要 COUNT 的表；userId 欄位名稱不同表不一樣（ownerId/userId/senderId/
// uploaderId/reporterId），這裡各自包一個小函式。
const COUNTERS: Record<RateLimitAction, Counter> = {
  item_create: (userId, since) =>
    db.item.count({ where: { ownerId: userId, createdAt: { gte: since } } }),
  claim_create: (userId, since) =>
    db.claimComment.count({ where: { userId, createdAt: { gte: since } } }),
  message_create: (userId, since) =>
    db.message.count({ where: { senderId: userId, createdAt: { gte: since } } }),
  upload_create: (userId, since) =>
    db.storageObject.count({ where: { uploaderId: userId, createdAt: { gte: since } } }),
  report_create: (userId, since) =>
    db.report.count({ where: { reporterId: userId, createdAt: { gte: since } } }),
  deal_info_create: (userId, since) =>
    db.dealInfo.count({ where: { submitterId: userId, createdAt: { gte: since } } }),
  deal_info_report_create: (userId, since) =>
    db.dealInfoReport.count({ where: { reporterId: userId, createdAt: { gte: since } } }),
};

export class RateLimitExceededError extends Error {}

/**
 * 檢查使用者這個動作是否超過每小時／每日上限，超過就丟 RateLimitExceededError
 * （呼叫端 catch 起來回 429）。沒超過就直接 resolve，不回傳值。
 *
 * 刻意在動作「真的要寫入之前」呼叫（例如上架驗證完欄位、留言驗證完物品狀態之後），
 * 這樣被擋下的請求不會產生任何副作用，也不會被自己這次的動作誤算進之後的計數。
 */
export async function checkRateLimit(userId: string, action: RateLimitAction): Promise<void> {
  const limits = RATE_LIMITS[action];
  const now = Date.now();
  const counter = COUNTERS[action];

  const hourlyCount = await counter(userId, new Date(now - HOUR_MS));
  if (hourlyCount >= limits.hourly) {
    throw new RateLimitExceededError(`操作過於頻繁，每小時最多 ${limits.hourly} 次，請稍後再試`);
  }

  const dailyCount = await counter(userId, new Date(now - DAY_MS));
  if (dailyCount >= limits.daily) {
    throw new RateLimitExceededError(`操作過於頻繁，每日最多 ${limits.daily} 次，請明天再試`);
  }
}
