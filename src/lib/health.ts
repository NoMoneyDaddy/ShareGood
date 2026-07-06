import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_JOB_RECENT_RUNS_CHECKED,
  HEALTH_JOB_STUCK_MINUTES,
} from "@/lib/ops-config";
import { BUCKET, s3 } from "@/lib/storage";

// master-plan §8a 交付內容 5：health_checks 儀表板。三個子系統各自獨立檢查、獨立回報，
// 一個掛掉不影響其他子系統的判定（例如 MinIO 斷線時 database 仍應正常回報 up）。
export type SubsystemKey = "database" | "storage" | "background_jobs";
export type SubsystemStatus = "up" | "degraded" | "down";

export interface SubsystemCheckResult {
  subsystem: SubsystemKey;
  status: SubsystemStatus;
  latencyMs: number | null;
  detail?: Record<string, unknown> | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** database 子系統：既有 `/api/health`（M0）邏輯不變，SELECT 1 量往返時間。 */
export async function checkDatabase(): Promise<SubsystemCheckResult> {
  const start = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return {
      subsystem: "database",
      status: "up",
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (e) {
    return {
      subsystem: "database",
      status: "down",
      latencyMs: null,
      detail: { error: errorMessage(e) },
    };
  }
}

/** storage 子系統：呼叫既有圖片管線用的 S3 client 做輕量 headBucket。 */
export async function checkStorage(): Promise<SubsystemCheckResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }), { abortSignal: controller.signal });
    return { subsystem: "storage", status: "up", latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      subsystem: "storage",
      status: "down",
      latencyMs: null,
      detail: { error: errorMessage(e) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * background_jobs 子系統：查每個已啟用 job 最近 N 筆 `system_job_runs`，判斷
 * 「有沒有卡住很久沒跑完」或「近期連續 failed」。異常時列出是哪個 `system_jobs.key`
 * 出問題（見規格），方便直接對應到各自的 job。
 */
export async function checkBackgroundJobs(): Promise<SubsystemCheckResult> {
  const start = performance.now();
  try {
    const jobs = await db.systemJob.findMany({
      where: { enabled: true },
      select: { id: true, key: true },
    });
    if (jobs.length === 0) {
      return {
        subsystem: "background_jobs",
        status: "up",
        latencyMs: Math.round(performance.now() - start),
        detail: { reason: "尚無註冊的 job" },
      };
    }

    const now = Date.now();
    const problems: { jobKey: string; issue: string; severity: SubsystemStatus }[] = [];

    for (const job of jobs) {
      const recentRuns = await db.systemJobRun.findMany({
        where: { jobId: job.id },
        orderBy: { startedAt: "desc" },
        take: HEALTH_JOB_RECENT_RUNS_CHECKED,
        select: { status: true, startedAt: true },
      });
      if (recentRuns.length === 0) continue; // 還沒排程執行過，不算異常

      const latest = recentRuns[0];
      if (latest.status === "running") {
        const ageMinutes = (now - latest.startedAt.getTime()) / 60_000;
        if (ageMinutes > HEALTH_JOB_STUCK_MINUTES) {
          problems.push({
            jobKey: job.key,
            issue: `執行中已超過 ${Math.round(ageMinutes)} 分鐘，疑似卡住`,
            severity: "down",
          });
          continue;
        }
      }

      if (
        recentRuns.length === HEALTH_JOB_RECENT_RUNS_CHECKED &&
        recentRuns.every((r) => r.status === "failed")
      ) {
        problems.push({
          jobKey: job.key,
          issue: `最近 ${HEALTH_JOB_RECENT_RUNS_CHECKED} 次執行連續失敗`,
          severity: "down",
        });
      } else if (latest.status === "failed") {
        problems.push({ jobKey: job.key, issue: "最近一次執行失敗", severity: "degraded" });
      }
    }

    const status: SubsystemStatus = problems.some((p) => p.severity === "down")
      ? "down"
      : problems.length > 0
        ? "degraded"
        : "up";

    return {
      subsystem: "background_jobs",
      status,
      latencyMs: Math.round(performance.now() - start),
      detail: problems.length > 0 ? { problems } : null,
    };
  } catch (e) {
    return {
      subsystem: "background_jobs",
      status: "down",
      latencyMs: null,
      detail: { error: errorMessage(e) },
    };
  }
}

/**
 * 三個子系統各自檢查＋各寫一筆進 `health_checks`（供 `/api/health` 與
 * `health_check_probe` job 共用，見 master-plan §8a 交付內容 5：「不透過 HTTP 自打自己」）。
 * 寫入歷史紀錄本身失敗（例如 DB 完全掛掉）不影響回傳的檢查結果——呼叫端（`/api/health`）
 * 仍然要能正確回報「database 掛了」，不能因為「順便寫歷史紀錄」這個次要動作失敗就跟著壞掉。
 */
export async function runHealthChecks(): Promise<SubsystemCheckResult[]> {
  const results = await Promise.all([checkDatabase(), checkStorage(), checkBackgroundJobs()]);

  await db.healthCheck
    .createMany({
      data: results.map((r) => ({
        subsystem: r.subsystem,
        status: r.status,
        latencyMs: r.latencyMs,
        detail: (r.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    })
    .catch(() => {
      // DB 完全掛掉時這裡也會失敗，吞掉即可——上面已經拿到檢查結果可以回傳給呼叫端。
    });

  return results;
}
