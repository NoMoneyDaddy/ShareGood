import { db } from "@/lib/db";
import {
  ERROR_LOGS_RETENTION_DAYS,
  HEALTH_CHECKS_RETENTION_DAYS,
  PERFORMANCE_METRICS_RETENTION_DAYS,
  RETENTION_BATCH_PAUSE_MS,
  RETENTION_BATCH_SIZE,
} from "@/lib/ops-config";

// master-plan §8a 交付內容 8：保留期清理 job。三張「僅供近期診斷用的高頻寫入表」
// （performance_metrics／error_logs／health_checks）用同一個 job 內聚處理；
// storage_usage_snapshots 不在此範圍內（需要長期趨勢，不設保留期）。

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 分批刪除單一表過期資料：`DELETE ... WHERE id IN (SELECT id FROM <table> WHERE
 * <時間欄位> < cutoff LIMIT batchSize)`，直到某次刪除筆數為 0。每批次之間短暫停頓，
 * 避免長時間佔用連線與鎖（規格明文禁止對這幾張高頻表下單一大型 DELETE）。
 */
async function deleteInBatches(deleteBatch: () => Promise<number>): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const deletedCount = await deleteBatch();
    totalDeleted += deletedCount;
    if (deletedCount < RETENTION_BATCH_SIZE) break;
    await sleep(RETENTION_BATCH_PAUSE_MS);
  }
  return totalDeleted;
}

export interface OpsRetentionCleanupSummary {
  performanceMetricsDeleted: number;
  errorLogsDeleted: number;
  healthChecksDeleted: number;
}

export async function runOpsRetentionCleanup(
  now: Date = new Date(),
): Promise<OpsRetentionCleanupSummary> {
  const performanceMetricsCutoff = new Date(
    now.getTime() - PERFORMANCE_METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const errorLogsCutoff = new Date(now.getTime() - ERROR_LOGS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const healthChecksCutoff = new Date(
    now.getTime() - HEALTH_CHECKS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const performanceMetricsDeleted = await deleteInBatches(async () => {
    const ids = await db.performanceMetric.findMany({
      where: { recordedAt: { lt: performanceMetricsCutoff } },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
    if (ids.length === 0) return 0;
    const { count } = await db.performanceMetric.deleteMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    return count;
  });

  const errorLogsDeleted = await deleteInBatches(async () => {
    const ids = await db.errorLog.findMany({
      where: { occurredAt: { lt: errorLogsCutoff } },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
    if (ids.length === 0) return 0;
    const { count } = await db.errorLog.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } });
    return count;
  });

  const healthChecksDeleted = await deleteInBatches(async () => {
    const ids = await db.healthCheck.findMany({
      where: { checkedAt: { lt: healthChecksCutoff } },
      select: { id: true },
      take: RETENTION_BATCH_SIZE,
    });
    if (ids.length === 0) return 0;
    const { count } = await db.healthCheck.deleteMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    return count;
  });

  return { performanceMetricsDeleted, errorLogsDeleted, healthChecksDeleted };
}
