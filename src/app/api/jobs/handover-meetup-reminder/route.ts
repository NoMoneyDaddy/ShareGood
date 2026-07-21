import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { MEETUP_REMINDER_WINDOW_MS, notifyMeetupReminderIfEnabled } from "@/lib/handover-meetup";

// POST /api/jobs/handover-meetup-reminder — M12 交付內容 5（面交約定時間，
// docs/plan/m12-product-growth.md）：由外部 cron 以 Authorization: Bearer ${CRON_SECRET}
// 定期觸發（規格建議每 15–30 分鐘一次，沿用 M3 item-expiration 既有的 system_jobs／
// CRON_SECRET 模式）。
//
// 掃描 status='pending' AND scheduledAt IS NOT NULL AND reminderSentAt IS NULL AND
// scheduledAt 落在 (now, now+2h] 的交接紀錄，逐筆用條件式 updateMany（WHERE
// reminderSentAt IS NULL AND status='pending'）當樂觀鎖搶佔設定 reminderSentAt=now()，
// count===1 才真的通知物主與接手者雙方——同一交接被重複觸發或多 worker 併發執行都
// idempotent（跟 M3 item-expiration／M5 lottery-draw 同一套既定模式）。
const JOB_KEY = "handover_meetup_reminder";
const BATCH_LIMIT = 500;

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "面交約定時間到期前提醒（M12 交付內容 5）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const now = new Date();
    const reminderDeadline = new Date(now.getTime() + MEETUP_REMINDER_WINDOW_MS);

    const candidates = await db.handoverRecord.findMany({
      where: {
        status: "pending",
        scheduledAt: { not: null, gt: now, lte: reminderDeadline },
        reminderSentAt: null,
      },
      select: {
        id: true,
        receiverId: true,
        scheduledAt: true,
        item: { select: { id: true, ownerId: true, title: true } },
      },
      take: BATCH_LIMIT,
    });

    let remindedCount = 0;
    for (const handover of candidates) {
      // scheduledAt 在上面的 where 已經確保 not null，這裡用 non-null assertion 是安全的。
      const scheduledAt = handover.scheduledAt as Date;
      const sent = await db.$transaction(async (tx) => {
        const claimed = await tx.handoverRecord.updateMany({
          where: { id: handover.id, reminderSentAt: null, status: "pending" },
          data: { reminderSentAt: now },
        });
        if (claimed.count === 0) return false;

        await notifyMeetupReminderIfEnabled(tx, {
          userId: handover.item.ownerId,
          itemId: handover.item.id,
          itemTitle: handover.item.title,
          scheduledAt,
        });
        await notifyMeetupReminderIfEnabled(tx, {
          userId: handover.receiverId,
          itemId: handover.item.id,
          itemTitle: handover.item.title,
          scheduledAt,
        });
        return true;
      });
      if (sent) remindedCount++;
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { remindedCount } },
    });

    return NextResponse.json({ jobRunId: run.id, remindedCount });
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
