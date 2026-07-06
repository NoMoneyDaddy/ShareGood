import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

// M0：原本只檢查 DB。M8（master-plan §8a 交付內容 5）擴充為三個子系統（database／
// storage／background_jobs）各自獨立回報，並把每次檢查結果各寫一筆進 `health_checks`
// 累積歷史紀錄——不論這次呼叫是外部監控平台打的，還是 `health_check_probe` job 定期探測。
export async function GET() {
  const results = await runHealthChecks();
  const overallUp = results.every((r) => r.status === "up");

  return NextResponse.json(
    {
      ok: overallUp,
      subsystems: Object.fromEntries(
        results.map((r) => [
          r.subsystem,
          { status: r.status, latencyMs: r.latencyMs, detail: r.detail ?? null },
        ]),
      ),
    },
    { status: overallUp ? 200 : 503 },
  );
}
