import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { runRetentionPurgeJob } from "@/lib/retention";

// retention_purge job（master-plan §7a 交付內容 4）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 每日觸發。逐一走過 data_retention_policies
// （is_active=true 且 retention_days 有設定）的政策，依政策設定執行清理，命中 legal hold
// 的目標一律跳過並記錄，細節見 src/lib/retention.ts。
const JOB_KEY = "retention_purge";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: {
      key: JOB_KEY,
      description: "依 data_retention_policies 設定執行資料清理（master-plan §7a）",
    },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const results = await runRetentionPurgeJob(run.id);
    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { results } },
    });
    return NextResponse.json({ jobRunId: run.id, results });
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
