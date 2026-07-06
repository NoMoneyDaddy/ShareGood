import type { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// 沿用 `src/app/api/jobs/storage-cleanup`／`item-expiration` 既有的 CRON_SECRET 驗證慣例。
export function isValidCronSecret(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
}

/**
 * 共用的 job 執行骨架：`system_jobs` upsert（key 存在就沿用，不重複建立）→ 開一筆
 * `system_job_runs`（status=running）→ 執行 `fn` → 成功寫 `detail`、失敗記下錯誤原因
 * 並把例外原樣往外拋（讓呼叫端的 route handler 因此丟出未捕捉例外，交給
 * `src/instrumentation.ts` 的 `onRequestError` 記一筆 `error_logs`，見 master-plan §8a
 * 交付內容 3；比照既有 `item-expiration` route 的 `runOnce`/丟出例外的做法）。
 *
 * `fn` 的回傳值必須是 JSON-safe（不能含 BigInt），因為會直接塞進 `SystemJobRun.detail`
 * 這個 Prisma Json 欄位。
 */
export async function runSystemJob<T extends object>(
  key: string,
  description: string,
  fn: () => Promise<T>,
): Promise<{ jobRunId: string; result: T }> {
  const job = await db.systemJob.upsert({
    where: { key },
    update: {},
    create: { key, description },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const result = await fn();
    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        detail: result as unknown as Prisma.InputJsonValue,
      },
    });
    return { jobRunId: run.id, result };
  } catch (e) {
    // 這個 update 呼叫本身若又失敗（例如 DB 斷線），不能讓它蓋掉原本真正的任務錯誤原因
    // ——外層一律往外拋原始的 `e`，這裡的失敗只用 console.error 留痕跡。
    try {
      await db.systemJobRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          detail: { error: e instanceof Error ? e.message : String(e) },
        },
      });
    } catch (updateError) {
      console.error(
        `runSystemJob: 寫入 system_job_runs（id=${run.id}）failed 狀態時發生錯誤，原始任務錯誤仍會照常往外拋`,
        updateError,
      );
    }
    throw e;
  }
}
