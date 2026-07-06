import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { runOpsRetentionCleanup } from "@/lib/ops-retention";
import { isValidCronSecret, runSystemJob } from "@/lib/system-jobs";

// master-plan §8a 交付內容 8：每日清理 performance_metrics（30 天）／error_logs
// （90 天）／health_checks（30 天）；storage_usage_snapshots 不在此範圍內。
export async function POST(req: NextRequest) {
  if (!isValidCronSecret(req)) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const { jobRunId, result } = await runSystemJob(
    "ops_retention_cleanup",
    "清理 performance_metrics／error_logs／health_checks 過期資料（master-plan §8a 交付內容 8）",
    async () => runOpsRetentionCleanup(),
  );

  return NextResponse.json({ jobRunId, ...result });
}
