import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { logError } from "@/lib/error-log";
import { ORPHAN_ITEM_STATUSES, STORAGE_USAGE_MISMATCH_TOLERANCE } from "@/lib/ops-config";
import { s3 } from "@/lib/storage";

// master-plan §8a 交付內容 2：Storage 用量儀表板。

interface ByStatusRow {
  status: string;
  bytes: bigint | number | string | null;
  count: bigint | number | string;
}

export interface StorageUsageSnapshotSummary {
  bucket: string;
  totalBytes: number;
  objectCount: number;
  orphanedBytes: number;
  orphanedCount: number;
  byItemStatus: Record<string, number>;
  mismatchDetected: boolean;
}

/** node-postgres 對 bigint 欄位的序列化行為不保證是 JS bigint，統一轉換以策安全。 */
function toBigInt(value: bigint | number | string | null | undefined): bigint {
  if (value === null || value === undefined) return BigInt(0);
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

/**
 * 兩個 bigint 的差異比例是否超過容忍度（用較大值當分母，避免除以 0）。
 * export 出來給 `e2e/integration/ops-storage-usage.test.ts` 直接單元測試邊界值，
 * 不需要真的資料庫或 MinIO。
 */
export function bytesMismatch(a: bigint, b: bigint, tolerance: number): boolean {
  if (a === BigInt(0) && b === BigInt(0)) return false;
  const diff = a > b ? a - b : b - a;
  const denom = a > b ? a : b;
  if (denom === BigInt(0)) return false;
  // MVP 規模的用量遠低於 Number 精度上限（2^53），轉 Number 算比例可接受。
  return Number(diff) / Number(denom) > tolerance;
}

/** MinIO 端實際掃描：ListObjectsV2 分頁加總 sizeBytes 與物件數（bucket 總用量的 ground truth）。 */
async function scanBucketUsage(
  bucket: string,
): Promise<{ totalBytes: bigint; objectCount: number }> {
  let totalBytes = BigInt(0);
  let objectCount = 0;
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const obj of res.Contents ?? []) {
      totalBytes += BigInt(obj.Size ?? 0);
      objectCount += 1;
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return { totalBytes, objectCount };
}

/**
 * DB 端依物品狀態分類的用量：`ItemImage` 同時有 `thumbObjectId`／`mediumObjectId` 兩個各自
 * 指向不同 `StorageObject` 的外鍵，這裡用一次查詢把兩條 FK 攤平成列（UNION ALL）再依
 * `items.status` 分組加總，避免只算其中一個漏算一半用量（見規格特別提醒）。孤兒用量
 * （`orphanedBytes`／`orphanedCount`）是同一組結果裡篩出終態物品狀態的子集，不需要
 * 額外查詢。
 *
 * export 出來給 `e2e/integration/ops-storage-usage.test.ts` 直接測試（本機沒有 MinIO，
 * 無法端到端測 `computeAndPersistStorageUsageSnapshot`，這支純 DB 查詢的部分可以獨立
 * 驗證正確性，見規格驗收清單「storage 用量計算邏輯正確性」）。
 */
export async function computeByItemStatusUsage(): Promise<{
  byItemStatus: Record<string, number>;
  orphanedBytes: bigint;
  orphanedCount: number;
}> {
  const rows = await db.$queryRaw<ByStatusRow[]>`
    SELECT status, SUM(size_bytes) AS bytes, COUNT(*) AS count
    FROM (
      SELECT i.status AS status, so.size_bytes AS size_bytes
      FROM item_images ii
      JOIN items i ON i.id = ii.item_id
      JOIN storage_objects so ON so.id = ii.thumb_object_id
      UNION ALL
      SELECT i.status AS status, so.size_bytes AS size_bytes
      FROM item_images ii
      JOIN items i ON i.id = ii.item_id
      JOIN storage_objects so ON so.id = ii.medium_object_id
    ) combined
    GROUP BY status
  `;

  const byItemStatus: Record<string, number> = {};
  let orphanedBytes = BigInt(0);
  let orphanedCount = 0;
  const orphanStatuses: readonly string[] = ORPHAN_ITEM_STATUSES;

  for (const row of rows) {
    const bytes = toBigInt(row.bytes);
    const count = toBigInt(row.count);
    byItemStatus[row.status] = Number(bytes);
    if (orphanStatuses.includes(row.status)) {
      orphanedBytes += bytes;
      orphanedCount += Number(count);
    }
  }

  return { byItemStatus, orphanedBytes, orphanedCount };
}

/**
 * 計算並寫入一筆 `storage_usage_snapshot`（`totalBytes`／`objectCount` 是 MinIO
 * ListObjectsV2 量到的 bucket 總用量；`byItemStatus`／孤兒用量是 DB 端依物品狀態分類的
 * 用量，兩者是不同維度，不需要相等）。同一次快照另外拿「DB 內所有非 deleted
 * `StorageObject.sizeBytes` 加總」跟 MinIO 總量做一致性交叉驗證，誤差超過容忍度就寫一筆
 * `error_logs` 提醒 admin（不讓快照 job 因此失敗，見規格）。
 */
export async function computeAndPersistStorageUsageSnapshot(
  bucket: string,
): Promise<StorageUsageSnapshotSummary> {
  const [minioUsage, byStatusUsage, dbAggregate] = await Promise.all([
    scanBucketUsage(bucket),
    computeByItemStatusUsage(),
    db.storageObject.aggregate({
      where: { status: { not: "deleted" } },
      _sum: { sizeBytes: true },
    }),
  ]);

  const dbTotalBytes = toBigInt(dbAggregate._sum.sizeBytes);
  const mismatchDetected = bytesMismatch(
    dbTotalBytes,
    minioUsage.totalBytes,
    STORAGE_USAGE_MISMATCH_TOLERANCE,
  );

  await db.storageUsageSnapshot.create({
    data: {
      bucket,
      totalBytes: minioUsage.totalBytes,
      objectCount: minioUsage.objectCount,
      orphanedBytes: byStatusUsage.orphanedBytes,
      orphanedCount: byStatusUsage.orphanedCount,
      byItemStatus: byStatusUsage.byItemStatus,
    },
  });

  if (mismatchDetected) {
    await logError({
      source: "background_job",
      routeOrJob: "storage_usage_snapshot",
      error: new Error(
        `bucket "${bucket}" 用量不一致：DB 加總 ${dbTotalBytes} bytes、` +
          `MinIO ListObjectsV2 加總 ${minioUsage.totalBytes} bytes`,
      ),
      context: {
        bucket,
        dbTotalBytes: dbTotalBytes.toString(),
        minioTotalBytes: minioUsage.totalBytes.toString(),
      },
    });
  }

  return {
    bucket,
    totalBytes: Number(minioUsage.totalBytes),
    objectCount: minioUsage.objectCount,
    orphanedBytes: Number(byStatusUsage.orphanedBytes),
    orphanedCount: byStatusUsage.orphanedCount,
    byItemStatus: byStatusUsage.byItemStatus,
    mismatchDetected,
  };
}
