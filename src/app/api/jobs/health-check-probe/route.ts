import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { runHealthChecks } from "@/lib/health";
import { isValidCronSecret, runSystemJob } from "@/lib/system-jobs";

// master-plan §8a 交付內容 5：定期探測，確保 health_checks 有穩定、可預期的取樣頻率
// （建議每 5 分鐘一次），不透過 HTTP 自打 `/api/health`，直接呼叫同一套內部檢查函式。
export async function POST(req: NextRequest) {
  if (!isValidCronSecret(req)) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const { jobRunId, result } = await runSystemJob(
    "health_check_probe",
    "定期探測 database／storage／background_jobs 三個子系統健康狀態（master-plan §8a 交付內容 5）",
    async () => {
      const results = await runHealthChecks();
      return {
        checked: results.length,
        subsystems: Object.fromEntries(results.map((r) => [r.subsystem, r.status])),
      };
    },
  );

  return NextResponse.json({ jobRunId, ...result });
}
