import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

// M0：原本只檢查 DB。M8（master-plan §8a 交付內容 5）擴充為三個子系統（database／
// storage／background_jobs）各自獨立回報，並把每次檢查結果各寫一筆進 `health_checks`
// 累積歷史紀錄——不論這次呼叫是外部監控平台打的，還是 `health_check_probe` job 定期探測。
//
// 這支端點不需要登入即可呼叫（給外部監控平台用），`detail` 裡可能包含原始例外訊息
// （見 `src/lib/health.ts` 的 `errorMessage`），不適合對外揭露，故公開回應只留
// `status`/`latencyMs`；完整 `detail` 已寫進 `health_checks` 資料表，管理員從
// `/admin/ops`（`GET /api/admin/ops/health`，限 moderator/admin）查詢。
export async function GET() {
  const results = await runHealthChecks();
  const overallUp = results.every((r) => r.status === "up");

  return NextResponse.json(
    {
      ok: overallUp,
      subsystems: Object.fromEntries(
        results.map((r) => [r.subsystem, { status: r.status, latencyMs: r.latencyMs }]),
      ),
    },
    { status: overallUp ? 200 : 503 },
  );
}
