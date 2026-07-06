import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { buildExportPackageFiles, zipExportPackage } from "@/lib/data-export";
import { db } from "@/lib/db";
import { createOrMergeNotification } from "@/lib/notifications";
import { putObject } from "@/lib/storage";

// data_export_generate job（master-plan §7a 交付內容 2）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 觸發（沿用 src/app/api/jobs/storage-cleanup 既有慣例）。
// 掃描 DataExport.status='pending'，逐筆處理：條件式 updateMany（pending -> processing）當
// 樂觀鎖防重複執行（比照 M5 開獎 job 手法），成功搶到才真的組資料/壓縮/上傳。
const JOB_KEY = "data_export_generate";
const BATCH_LIMIT = 20;
const DEFAULT_RETENTION_DAYS = 7;

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "使用者資料匯出包產生（master-plan §7a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  let generated = 0;
  let failed = 0;
  try {
    const pending = await db.dataExport.findMany({
      where: { status: "pending" },
      take: BATCH_LIMIT,
      orderBy: { requestedAt: "asc" },
    });

    for (const exportRow of pending) {
      const claimed = await db.dataExport.updateMany({
        where: { id: exportRow.id, status: "pending" },
        data: { status: "processing" },
      });
      if (claimed.count === 0) continue; // 被別次執行搶走，跳過

      try {
        const policy = await db.dataRetentionPolicy.findUnique({
          where: { policyKey: "data_exports" },
        });
        const retentionDays =
          policy?.isActive && policy.retentionDays !== null
            ? policy.retentionDays
            : DEFAULT_RETENTION_DAYS;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

        const files = await buildExportPackageFiles(exportRow.userId, {
          signedUrlExpiresInSeconds: retentionDays * 24 * 60 * 60,
          generatedAt: now,
          expiresAt,
        });
        const zipBuffer = await zipExportPackage(files);

        const objectKey = `exports/${exportRow.userId}/${exportRow.id}.zip`;
        await putObject(objectKey, zipBuffer, "application/zip");

        await db.$transaction(async (tx) => {
          const storageObject = await tx.storageObject.create({
            data: {
              objectKey,
              kind: "export_package",
              status: "linked",
              mimeType: "application/zip",
              sizeBytes: zipBuffer.byteLength,
              uploaderId: exportRow.userId,
              linkedAt: now,
            },
          });
          await tx.dataExport.update({
            where: { id: exportRow.id },
            data: { status: "ready", storageObjectId: storageObject.id, readyAt: now, expiresAt },
          });
          await tx.privacyRequest.update({
            where: { id: exportRow.privacyRequestId },
            data: { status: "completed", completedAt: now },
          });
          await createOrMergeNotification(tx, {
            userId: exportRow.userId,
            type: "completion_confirmed",
            payload: { kind: "data_export_ready", dataExportId: exportRow.id },
          });
        });

        generated++;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        await db.$transaction(async (tx) => {
          await tx.dataExport.update({
            where: { id: exportRow.id },
            data: { status: "failed", failureReason: message.slice(0, 500) },
          });
          await tx.privacyRequest.update({
            where: { id: exportRow.privacyRequestId },
            data: { status: "rejected" },
          });
        });
      }
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { generated, failed } },
    });
    return NextResponse.json({ jobRunId: run.id, generated, failed });
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
