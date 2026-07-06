import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { isValidCronSecret, runSystemJob } from "@/lib/system-jobs";

// POST /api/jobs/deal-info-expiration — DealInfo 硬性 TTL（master-plan §9a 交付內容 1）。
// 複用 M3 item-expiration 的 job 架構（同一套 system_jobs／system_job_runs／CRON_SECRET
// 機制，不重新發明排程）：每次執行把 status IN (published, stale) 且 expires_at <= now()
// 的 DealInfo 轉 expired。跟 item-expiration 不同的是這裡不需要逐筆處理再各自寫一筆
// unique 的 log 列來保 idempotent——DealInfo 沒有交接流程可能把它「拉出」published/stale
// 之外的並行風險（item 那邊要顧慮的是「物品剛好被認領」這種並行轉態），單一批次
// `updateMany({ where: { status: { in: [...] }, expiresAt: { lte: now } } })`
// 本身就是 idempotent 的：轉成 expired 之後的資料列不再符合 `status IN (published,
// stale)` 這個 where 條件，重複觸發不會被再次計入或重複轉態。
export async function POST(req: NextRequest) {
  if (!isValidCronSecret(req)) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const { jobRunId, result } = await runSystemJob(
    "deal_info_expiration",
    "DealInfo 硬性 TTL 到期轉態（master-plan §9a 交付內容 1）",
    async () => {
      const now = new Date();
      const expired = await db.dealInfo.updateMany({
        where: {
          status: { in: [DealInfoStatus.published, DealInfoStatus.stale] },
          expiresAt: { lte: now },
        },
        data: { status: DealInfoStatus.expired },
      });
      return { expiredCount: expired.count };
    },
  );

  return NextResponse.json({ jobRunId, ...result });
}
