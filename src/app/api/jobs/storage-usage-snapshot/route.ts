import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { BUCKET } from "@/lib/storage";
import { computeAndPersistStorageUsageSnapshot } from "@/lib/storage-usage";
import { isValidCronSecret, runSystemJob } from "@/lib/system-jobs";

// master-plan §8a 交付內容 2：每日 storage 用量快照，沿用 M3 建立的排程觸發機制
// （`system_jobs` key = "storage_usage_snapshot"），由外部 cron 以
// `Authorization: Bearer ${CRON_SECRET}` 觸發。
export async function POST(req: NextRequest) {
  if (!isValidCronSecret(req)) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const { jobRunId, result } = await runSystemJob(
    "storage_usage_snapshot",
    "每日 storage 用量快照，含孤兒用量與 DB/MinIO 一致性交叉驗證（master-plan §8a 交付內容 2）",
    async () => computeAndPersistStorageUsageSnapshot(BUCKET),
  );

  return NextResponse.json({ jobRunId, ...result });
}
