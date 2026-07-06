import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  createSubscriptionNotificationIfEnabled,
  dispatchWebPushForNotification,
} from "@/lib/subscription-notify";

// 每日摘要 job（master-plan §6a 交付內容 8）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 每天 08:00 Asia/Taipei 觸發一次（沿用
// item-expiration job 既有 CRON_SECRET 驗證慣例）。
const JOB_KEY = "subscription_daily_digest";
const DIGEST_PREVIEW_LIMIT = 10;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 回傳代表「現在對應的台北曆日」的純日期 Date，給 `subscriptionDigestJob.digestDate`
 * （`@db.Date` 欄位）用。
 *
 * 注意：這跟 `src/lib/notifications.ts` 的 `startOfTaipeiDay`（給 `timestamptz` 欄位的
 * range 查詢用）目的不同、不能互換——`startOfTaipeiDay` 最後會再減一次 TAIPEI_OFFSET_MS
 * 換算回「台北午夜對應的實際 UTC 時間點」，拿來給 `@db.Date` 欄位會因為序列化成 UTC ISO
 * 字串後被 Postgres 取走前一天的日期而錯一天。這裡只需要「用台北當地年/月/日構造一個
 * UTC 午夜的 Date」，不做那次額外的時區位移。
 */
function taipeiCalendarDate(now: Date): Date {
  const taipeiMs = now.getTime() + TAIPEI_OFFSET_MS;
  const t = new Date(taipeiMs);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "訂閱每日摘要（master-plan §6a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const now = new Date();
    const digestDate = taipeiCalendarDate(now);

    // 找出所有 notifiedAt IS NULL 且訂閱 dailyDigestEnabled=true 的 match，依 userId 分組
    // （master-plan §6a 交付內容 8）。
    const pendingMatches = await db.subscriptionMatch.findMany({
      where: { notifiedAt: null, subscription: { dailyDigestEnabled: true } },
      include: {
        subscription: { select: { id: true, userId: true, label: true } },
        item: { select: { id: true, title: true, status: true, city: { select: { name: true } } } },
      },
    });

    const byUser = new Map<string, typeof pendingMatches>();
    for (const m of pendingMatches) {
      const uid = m.subscription.userId;
      const list = byUser.get(uid);
      if (list) {
        list.push(m);
      } else {
        byUser.set(uid, [m]);
      }
    }

    let sentCount = 0;
    let skippedEmptyCount = 0;
    let alreadyDoneCount = 0;
    let errorCount = 0;

    for (const [userId, matches] of byUser) {
      // 跟 subscription-match-scan job 同樣的道理：單一使用者的摘要處理出錯（例如 Web Push
      // 派送時的非預期錯誤）不該讓整個 job 中斷，否則後面所有使用者當天都收不到摘要通知。
      // 記錄下來跳過這個使用者，繼續處理其餘使用者。
      try {
        const result = await processUserDigest(userId, digestDate, matches, now);
        if (result === "sent") sentCount++;
        else if (result === "skipped_empty") skippedEmptyCount++;
        else alreadyDoneCount++;
      } catch (e) {
        errorCount++;
        console.error(`[subscription-daily-digest] processUserDigest 失敗 userId=${userId}:`, e);
      }
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        detail: {
          processedUsers: byUser.size,
          sentCount,
          skippedEmptyCount,
          alreadyDoneCount,
          errorCount,
        },
      },
    });

    return NextResponse.json({
      jobRunId: run.id,
      processedUsers: byUser.size,
      sentCount,
      skippedEmptyCount,
      alreadyDoneCount,
      errorCount,
    });
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

type PendingMatch = {
  id: string;
  subscription: { id: string; userId: string; label: string | null };
  item: { id: string; title: string; status: string; city: { name: string } };
};

/**
 * 處理單一使用者的今日摘要（master-plan §6a 交付內容 8）：
 * - `INSERT ... ON CONFLICT (user_id, digest_date) DO NOTHING` 語意 → 用 create + 捕捉
 *   P2002 模擬；撞到既有列時，`status IN ('sent','skipped_empty')` 代表今天已經處理過，
 *   直接跳過（"already_done"）；`status IN ('failed','pending')` 允許重新處理，沿用同一列。
 * - 過濾掉物品目前狀態已經不是 published 的 match（避免摘要出現死連結）；這些被過濾掉的列
 *   仍然蓋章 notifiedAt/notifiedVia/digestJobId，只是不放進通知內容。
 * - 過濾後剩餘 0 筆 → status='skipped_empty'，不建立通知。
 */
async function processUserDigest(
  userId: string,
  digestDate: Date,
  matches: PendingMatch[],
  now: Date,
): Promise<"sent" | "skipped_empty" | "already_done"> {
  let digestJobId: string;
  try {
    const created = await db.subscriptionDigestJob.create({
      data: { userId, digestDate, status: "pending" },
    });
    digestJobId = created.id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const existing = await db.subscriptionDigestJob.findUniqueOrThrow({
      where: { userId_digestDate: { userId, digestDate } },
    });
    if (existing.status === "sent" || existing.status === "skipped_empty") {
      return "already_done";
    }
    digestJobId = existing.id;
  }

  const displayMatches = matches.filter((m) => m.item.status === "published");

  const txResult = await db.$transaction(async (tx) => {
    await tx.subscriptionMatch.updateMany({
      where: { id: { in: matches.map((m) => m.id) } },
      data: { notifiedAt: now, notifiedVia: "digest", digestJobId },
    });

    if (displayMatches.length === 0) {
      await tx.subscriptionDigestJob.update({
        where: { id: digestJobId },
        data: { status: "skipped_empty", itemCount: 0 },
      });
      return { status: "skipped_empty" as const, notifyOutcome: null };
    }

    const notifyOutcome = await createSubscriptionNotificationIfEnabled(tx, {
      userId,
      eventType: "subscription_digest",
      payload: {
        kind: "subscription_digest",
        digestJobId,
        totalCount: displayMatches.length,
        items: displayMatches.slice(0, DIGEST_PREVIEW_LIMIT).map((m) => ({
          itemId: m.item.id,
          itemTitle: m.item.title,
          itemCityName: m.item.city.name,
        })),
      },
    });

    await tx.subscriptionDigestJob.update({
      where: { id: digestJobId },
      data: { status: "sent", itemCount: displayMatches.length, sentAt: now },
    });

    return { status: "sent" as const, notifyOutcome };
  });

  if (txResult.status === "sent" && txResult.notifyOutcome) {
    await dispatchWebPushForNotification({
      userId,
      notificationId: txResult.notifyOutcome.notificationId,
      externalEnabled: txResult.notifyOutcome.externalEnabled,
      pushPayload: {
        title: "今日訂閱摘要",
        body: `今天有 ${displayMatches.length} 件符合你訂閱條件的新物品`,
        itemUrl: "/me/subscriptions",
      },
    });
  }

  return txResult.status;
}
