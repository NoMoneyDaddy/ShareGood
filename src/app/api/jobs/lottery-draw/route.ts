import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { advanceLotteryVacancy, drawLottery } from "@/lib/lottery";

// 抽籤開獎與遞補 job（master-plan §5a 交付內容 5）：沿用 M3 建立的 system_jobs／
// system_job_runs 排程觸發＋idempotent 執行框架（同一套 CRON_SECRET 保護的 route 觸發模式，
// 見 src/app/api/jobs/item-expiration/route.ts），新增一個 job kind 掛上去，不重新發明。
// 建議執行頻率每 15 分鐘一次，實際頻率由屆時的 cron 基礎設施決定。
//
// 每次執行做兩件事：
// (a) 開獎：找出 status='open' AND entry_deadline<=now() 的抽籤，逐筆呼叫 drawLottery。
// (b) 遞補推進：找出 lottery_results.status='offered' AND confirm_deadline<=now() 的列
//     （代表逾時未確認），逐筆呼叫 advanceLotteryVacancy 轉 expired 並嘗試遞補下一位。
//
// Idempotent／併發安全：drawLottery／advanceLotteryVacancy 內部都用條件式 updateMany
// 當樂觀鎖，重複觸發或多個 worker 同時處理同一筆抽籤只有一次會真的執行，其餘是 no-op
// （見 src/lib/lottery.ts 的說明）。
const JOB_KEY = "lottery_draw";
const BATCH_LIMIT = 200; // 單次執行處理上限，避免單一 request 執行過久

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "抽籤開獎與逾時遞補（master-plan §5a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const now = new Date();

    const drawnCount = await processDraws(now);
    const advancedCount = await processVacancies(now);

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { drawnCount, advancedCount } },
    });

    return NextResponse.json({ jobRunId: run.id, drawnCount, advancedCount });
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

async function processDraws(now: Date): Promise<number> {
  const candidates = await db.lottery.findMany({
    where: { status: "open", entryDeadline: { lte: now } },
    select: { id: true },
    take: BATCH_LIMIT,
  });

  let count = 0;
  for (const candidate of candidates) {
    const outcome = await drawLottery(candidate.id, now);
    if (outcome !== "skipped") count++;
  }
  return count;
}

async function processVacancies(now: Date): Promise<number> {
  const expiredOffers = await db.lotteryResult.findMany({
    where: { status: "offered", confirmDeadline: { lte: now } },
    select: { id: true, lotteryId: true, rank: true },
    take: BATCH_LIMIT,
  });

  let count = 0;
  for (const offer of expiredOffers) {
    const outcome = await advanceLotteryVacancy({
      lotteryId: offer.lotteryId,
      expectedRank: offer.rank,
      resultId: offer.id,
      newStatus: "expired",
      now,
      actorId: null,
    });
    if (outcome !== "skipped") count++;
  }
  return count;
}
