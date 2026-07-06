import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";

const JOB_KEY = "item_expiration_check";
const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 到期前 3 天內提醒
const BATCH_SIZE = 200; // 每次最多處理 200 筆，避免單次 request 過長（比照 storage-cleanup）

// NotificationType 這個 enum（見 prisma/schema.prisma）目前只有 M1 留下的五個值
// （new_comment/claim_accepted/direct_share_received/handover_message/completion_confirmed），
// 沒有涵蓋「到期」「即將到期提醒」這兩種事件，而這次任務明確要求不能動 schema.prisma／
// 不能跑 migration。因此借用語意上最接近「物品相關的系統訊息」的 "handover_message" 當作
// type 的佔位值，實際文字改用 payload.expirationAction 判斷（見
// src/app/notifications/page.tsx 的 describeNotification：已改成優先看
// payload.expirationAction，不受這個佔位 type 影響）。這是為了不違反「不改 schema」限制
// 而做的技術妥協，詳見 docs/governance/lessons/20260706-notification-type-enum-missing-expiration.md。
const EXPIRATION_NOTIFICATION_TYPE = "handover_message" as const;

type ItemForJob = { id: string; ownerId: string; title: string };

// POST /api/jobs/expiration-check：到期檢查 job（master-plan §8）。
// 由外部 cron 以 Authorization: Bearer ${CRON_SECRET} 觸發（驗證方式比照
// src/app/api/jobs/storage-cleanup/route.ts）；外部排程平台（Zeabur 上的 Cronicle/
// Crontab UI 或 cron-job.org/GitHub Actions）留給使用者之後自行設定，這裡只做手動觸發
// 也能跑通的版本。
//
// 一次執行做兩件事：
//   1. 已過期（status='published' 且 expiresAt<=now）→ 轉 expired，寫 ItemStatusLog，通知物主。
//   2. 即將到期（status='published' 且 expiresAt 落在未來 3 天內）→ 不轉狀態，只發一次提醒。
// 兩者都靠 ItemExpirationLog 的 @@unique([itemId, action]) 當 idempotent 防線：
// 用 create 寫入該筆 log，撞到 P2002（唯一索引衝突）就代表已經處理過，直接跳過，
// 不會重複轉狀態、不會重複發通知。
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    create: { key: JOB_KEY, description: "物品到期檢查：過期轉 expired＋即期 3 天前提醒" },
    update: {},
  });

  const run = await db.systemJobRun.create({
    data: { jobId: job.id, status: "running" },
  });

  try {
    const now = new Date();

    const expiredCandidates = await db.item.findMany({
      where: { status: "published", expiresAt: { lte: now } },
      take: BATCH_SIZE,
      select: { id: true, ownerId: true, title: true },
    });

    let expiredCount = 0;
    for (const item of expiredCandidates) {
      if (await expireItem(item)) expiredCount++;
    }

    const reminderCandidates = await db.item.findMany({
      where: {
        status: "published",
        expiresAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) },
      },
      take: BATCH_SIZE,
      select: { id: true, ownerId: true, title: true },
    });

    let reminderCount = 0;
    for (const item of reminderCandidates) {
      if (await sendExpirationReminder(item)) reminderCount++;
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        detail: {
          expiredCandidates: expiredCandidates.length,
          expiredCount,
          reminderCandidates: reminderCandidates.length,
          reminderCount,
        },
      },
    });

    return NextResponse.json({ jobRunId: run.id, expiredCount, reminderCount });
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

// 單筆「轉 expired」：ItemExpirationLog(action='expired') create 成功才繼續做狀態轉換與
// 通知，全部包在同一個 transaction 裡，任何一步失敗都整筆回滾、不留半套資料。
async function expireItem(item: ItemForJob): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      await tx.itemExpirationLog.create({
        data: { itemId: item.id, action: "expired" },
      });

      const updated = await tx.item.updateMany({
        where: { id: item.id, status: "published" },
        data: { status: "expired" },
      });
      if (updated.count === 0) {
        // 極端情況：查詢之後、transaction 之前，物品狀態被別的流程改掉（例如被下架）。
        // ItemExpirationLog 已經寫入，之後不會再被重複挑到，視為處理完成即可，不算 job 出錯。
        return;
      }

      await tx.itemStatusLog.create({
        data: {
          itemId: item.id,
          fromStatus: "published",
          toStatus: "expired",
          actorId: null,
          reason: "已超過設定的到期時間，系統自動下架",
        },
      });

      await tx.notification.create({
        data: {
          userId: item.ownerId,
          type: EXPIRATION_NOTIFICATION_TYPE,
          payload: { itemId: item.id, itemTitle: item.title, expirationAction: "expired" },
        },
      });
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false; // 已經處理過（重複觸發），跳過
    }
    throw e;
  }
}

// 單筆「即將到期提醒」：不轉狀態，只靠 ItemExpirationLog(action='reminder_sent') 擋重複提醒。
async function sendExpirationReminder(item: ItemForJob): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      await tx.itemExpirationLog.create({
        data: { itemId: item.id, action: "reminder_sent" },
      });

      await tx.notification.create({
        data: {
          userId: item.ownerId,
          type: EXPIRATION_NOTIFICATION_TYPE,
          payload: { itemId: item.id, itemTitle: item.title, expirationAction: "reminder_sent" },
        },
      });
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false; // 已經提醒過，跳過
    }
    throw e;
  }
}
