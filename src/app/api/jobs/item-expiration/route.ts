import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";

// 到期 job（master-plan §8）：由外部 cron 以 Authorization: Bearer ${CRON_SECRET} 每日觸發一次
// （沿用 src/app/api/jobs/storage-cleanup 既有的 CRON_SECRET 驗證慣例）。
//
// 處理兩件事：
// 1. 已過期：published 且 expiresAt 已過的物品轉 expired，通知物主。
// 2. 即將到期提醒：published 且 expiresAt 落在未來 3 天內的物品，通知物主（只提醒一次）。
//
// 範圍刻意只處理 status='published' 的物品：一旦物品進入 reserved／handover_pending／completed，
// 代表已經配對成功、正在或已經交接，expiresAt 代表的是券碼／食品本身的到期日（給接手者參考用），
// 不應該被這支 job 強制改動物品狀態或洗掉交接進度——這跟 M1 既有交接流程完全不相關，不動它。
//
// Idempotent 設計：每個物品每種 action（expired／reminder_sent）在 ItemExpirationLog 最多一筆
// （schema 的 @@unique([itemId, action])），因此就算 job 被重複觸發或並行觸發，同一物品的
// 轉態與通知也只會真的發生一次——後到的請求會撞 unique constraint（P2002），視為「已經處理過」
// 直接跳過，不視為錯誤。
const JOB_KEY = "item_expiration";
const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 到期前 3 天
const BATCH_LIMIT = 500; // 單次執行處理上限，避免單一 request 執行過久；剩餘留給下次觸發繼續處理

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "優惠券／即期食品到期轉態與到期提醒（master-plan §8）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const now = new Date();

    const expiredCount = await processExpired(now);
    const reminderCount = await processReminders(now);

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { expiredCount, reminderCount } },
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

async function processExpired(now: Date): Promise<number> {
  const items = await db.item.findMany({
    where: {
      status: "published",
      expiresAt: { lte: now },
      expirationLogs: { none: { action: "expired" } },
    },
    select: { id: true, ownerId: true, title: true },
    take: BATCH_LIMIT,
  });

  let count = 0;
  for (const item of items) {
    const expired = await runOnce(async (tx) => {
      // 先用帶 status: "published" 條件的 updateMany 轉態，而不是無條件 update：如果在
      // 上面查出候選清單之後、實際執行這個 transaction 之前，物品剛好被別人預約或開始
      // 交接（狀態變成 reserved／handover_pending），代表它已經進入 M1 的交接流程，這支
      // job 不該強制把它蓋成 expired、蓋掉正在進行的交接。updateMany 的 count === 0
      // 就代表物品已經不是 published，直接跳過——刻意不寫 ItemExpirationLog／
      // itemStatusLog／notification，讓它自然被排除即可（它可能正在走交接流程）。
      const updated = await tx.item.updateMany({
        where: { id: item.id, status: "published" },
        data: { status: "expired" },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.itemExpirationLog.create({ data: { itemId: item.id, action: "expired" } });
      await tx.itemStatusLog.create({
        data: {
          itemId: item.id,
          fromStatus: "published",
          toStatus: "expired",
          actorId: null,
          reason: "到期 job 自動轉態",
        },
      });
      // NotificationType enum 沒有專屬的「物品到期」類型（M2/M3/M4 schema 地基定案時未新增，
      // 見 master-plan §8 與 PR 說明的差異說明）；重用 completion_confirmed 並在 payload 帶
      // kind: "item_expired" 讓 UI 顯示正確文字，沿用既有 thanks/route.ts、
      // direct-shares/[shareId]/route.ts 重用 NotificationType 的既定做法。
      await tx.notification.create({
        data: {
          userId: item.ownerId,
          type: "completion_confirmed",
          payload: { itemId: item.id, itemTitle: item.title, kind: "item_expired" },
        },
      });
      return true;
    });
    if (expired) count++;
  }
  return count;
}

async function processReminders(now: Date): Promise<number> {
  const reminderDeadline = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const items = await db.item.findMany({
    where: {
      status: "published",
      expiresAt: { gt: now, lte: reminderDeadline },
      expirationLogs: { none: { action: "reminder_sent" } },
    },
    select: { id: true, ownerId: true, title: true },
    take: BATCH_LIMIT,
  });

  let count = 0;
  for (const item of items) {
    const processed = await runOnce(async (tx) => {
      await tx.itemExpirationLog.create({ data: { itemId: item.id, action: "reminder_sent" } });
      await tx.notification.create({
        data: {
          userId: item.ownerId,
          type: "completion_confirmed",
          payload: { itemId: item.id, itemTitle: item.title, kind: "item_expiring_reminder" },
        },
      });
      return true;
    });
    if (processed) count++;
  }
  return count;
}

// 執行一個 transaction；撞到 ItemExpirationLog 的 unique constraint（P2002）代表這個物品已經
// 被別次 job 執行處理過，視為正常跳過（回傳 false），其餘錯誤照常往上拋。回傳值沿用 fn 的
// 回傳值，讓呼叫端可以分辨「transaction 執行完成但選擇跳過（回傳 false）」跟「真的處理了」。
async function runOnce<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | false> {
  try {
    return await db.$transaction(fn);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false;
    }
    throw e;
  }
}
