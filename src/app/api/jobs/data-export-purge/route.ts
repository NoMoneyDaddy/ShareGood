import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { filterUnderLegalHold } from "@/lib/legal-hold";
import { deleteObject } from "@/lib/storage";

// data_export_purge job（master-plan §7a 交付內容 2）：每日掃描
// DataExport.status='ready' AND expiresAt<=now()，清掉逾期的匯出包。跟既有 M0 孤兒檔清理
// job（src/app/api/jobs/storage-cleanup）同構：先確認沒有命中 legal hold，再刪 MinIO 物件、
// 標記 StorageObject.status='deleted'，並把 DataExport 轉 expired。
const JOB_KEY = "data_export_purge";
const BATCH_LIMIT = 200;

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "逾期資料匯出包清除（master-plan §7a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  let purged = 0;
  let skippedLegalHold = 0;
  try {
    const expired = await db.dataExport.findMany({
      where: { status: "ready", expiresAt: { lte: new Date() } },
      take: BATCH_LIMIT,
      include: { storageObject: true },
    });

    // 批次查詢一次，迴圈內只查表（master-plan §7a 交付內容 4 對 N+1 的明確要求）。
    const heldIds = await filterUnderLegalHold(
      "data_export",
      expired.map((e) => e.id),
    );

    for (const exportRow of expired) {
      const held = heldIds.has(exportRow.id);
      if (held) {
        skippedLegalHold++;
        await db.dataPurgeLog.create({
          data: {
            policyKey: "data_exports",
            jobRunId: run.id,
            targetType: "data_export",
            targetId: exportRow.id,
            actionTaken: "purge",
            skippedLegalHold: true,
          },
        });
        continue;
      }

      // 條件式 updateMany 當樂觀鎖：如果另一個併發跑的 job 已經搶先把這筆轉成
      // expired，這裡 count===0 就跳過，避免兩個 job 同時對同一個 S3 物件重複刪除、
      // 重複寫 data_purge_logs。
      const claimed = await db.dataExport.updateMany({
        where: { id: exportRow.id, status: "ready" },
        data: { status: "expired" },
      });
      if (claimed.count === 0) continue;

      if (exportRow.storageObject) {
        await deleteObject(exportRow.storageObject.objectKey).catch(() => {
          /* MinIO 上已不存在也視為清理成功 */
        });
        await db.storageObject.update({
          where: { id: exportRow.storageObject.id },
          data: { status: "deleted", deletedAt: new Date() },
        });
      }
      await db.dataPurgeLog.create({
        data: {
          policyKey: "data_exports",
          jobRunId: run.id,
          targetType: "data_export",
          targetId: exportRow.id,
          actionTaken: "purge",
          skippedLegalHold: false,
        },
      });
      purged++;
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { purged, skippedLegalHold } },
    });
    return NextResponse.json({ jobRunId: run.id, purged, skippedLegalHold });
  } catch (e) {
    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        detail: { error: e instanceof Error ? e.message : String(e) },
      },
    });
    throw e;
  }
}
