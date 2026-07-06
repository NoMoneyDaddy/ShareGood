import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { isUnderLegalHold } from "@/lib/legal-hold";
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

    for (const exportRow of expired) {
      const held = await isUnderLegalHold("data_export", exportRow.id);
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

      if (exportRow.storageObject) {
        await deleteObject(exportRow.storageObject.objectKey).catch(() => {
          /* MinIO 上已不存在也視為清理成功 */
        });
        await db.storageObject.update({
          where: { id: exportRow.storageObject.id },
          data: { status: "deleted", deletedAt: new Date() },
        });
      }
      await db.dataExport.update({ where: { id: exportRow.id }, data: { status: "expired" } });
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
