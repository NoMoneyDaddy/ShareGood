import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { processNotificationRetry } from "@/lib/notification-retry";
import { isValidCronSecret, runSystemJob } from "@/lib/system-jobs";

// master-plan §8a 交付內容 6：通知失敗指數退避重送，建議每 5–10 分鐘觸發一次。
export async function POST(req: NextRequest) {
  if (!isValidCronSecret(req)) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const { jobRunId, result } = await runSystemJob(
    "notification_retry",
    "通知失敗指數退避重送＋Telegram 帳號失效自動解綁（master-plan §8a 交付內容 6）",
    async () => processNotificationRetry(),
  );

  return NextResponse.json({ jobRunId, ...result });
}
