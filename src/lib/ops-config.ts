// M8 營運強化（master-plan.md §8a）數值集中管理，比照 M1 `src/lib/contribution.ts`
// 「數值進 config 不寫死」的慣例，避免分散寫死在各個 job／API 裡。

// ===== 交付內容 3：慢查詢紀錄 =====
/** 單次查詢耗時超過此門檻即時標記 `PerformanceMetric.isSlow`（呼應 §12 P95 < 1s 的目標）。 */
export const SLOW_QUERY_THRESHOLD_MS = 1000;

// ===== 交付內容 8：保留期清理 job =====
export const PERFORMANCE_METRICS_RETENTION_DAYS = 30;
export const ERROR_LOGS_RETENTION_DAYS = 90;
export const HEALTH_CHECKS_RETENTION_DAYS = 30;
// storage_usage_snapshots 不設保留期（見交付內容 3 說明），此處故意不列常數。

/** 保留期清理 job 每批次刪除筆數上限，避免單一大型 DELETE 長時間鎖表。 */
export const RETENTION_BATCH_SIZE = 5000;
/** 每批次刪除之間的暫停時間（毫秒），讓其他查詢有機會插隊。 */
export const RETENTION_BATCH_PAUSE_MS = 50;

// ===== 交付內容 2：Storage 用量儀表板 =====
/** DB 加總與 MinIO ListObjectsV2 加總的 bucket 總量誤差容忍度（超過視為資料落差）。 */
export const STORAGE_USAGE_MISMATCH_TOLERANCE = 0.01;
/** 判定「已下架但圖片未清」孤兒用量的終態物品狀態。 */
export const ORPHAN_ITEM_STATUSES = ["removed_by_user", "removed_by_moderator", "expired"] as const;

// ===== 交付內容 5：健康檢查儀表板 =====
/** background_jobs 子系統：單一 job 執行中超過此時間視為「卡住」。 */
export const HEALTH_JOB_STUCK_MINUTES = 30;
/** background_jobs 子系統：檢查最近幾筆執行紀錄判斷是否連續失敗。 */
export const HEALTH_JOB_RECENT_RUNS_CHECKED = 3;
/** MinIO headBucket／DB SELECT 1 呼叫逾時（毫秒）。 */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

// ===== 交付內容 6：通知失敗重送 =====
/** 最大重試次數，達到後不再被重送 job 挑中。 */
export const NOTIFICATION_MAX_ATTEMPTS = 5;
/** 指數退避基數（秒）：第 N 次失敗後等待 min(2^N × 基數, 上限) 秒。 */
export const NOTIFICATION_BACKOFF_BASE_SECONDS = 60;
/** 指數退避秒數上限（1 小時）。 */
export const NOTIFICATION_BACKOFF_MAX_SECONDS = 3600;
/** 判定「帳號已失效」需要連續幾筆 delivery 都失敗且訊息符合特徵。 */
export const TELEGRAM_CONSECUTIVE_FAILURES_FOR_DEACTIVATION = 3;
/** 每次重送 job 執行最多處理幾筆 delivery，避免單次 request 執行過久。 */
export const NOTIFICATION_RETRY_BATCH_LIMIT = 200;

/** 指數退避秒數：`min(2^attempts × 基數, 上限)`。 */
export function notificationBackoffSeconds(attempts: number): number {
  return Math.min(
    2 ** attempts * NOTIFICATION_BACKOFF_BASE_SECONDS,
    NOTIFICATION_BACKOFF_MAX_SECONDS,
  );
}
