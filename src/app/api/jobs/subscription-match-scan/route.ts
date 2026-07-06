import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  createSubscriptionNotificationIfEnabled,
  dispatchWebPushForNotification,
} from "@/lib/subscription-notify";
import { buildNormalizedItemText, isMatch } from "@/lib/subscriptions";

// 訂閱條件比對排程掃描 job（master-plan §6a 交付內容 4）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 每 5 分鐘觸發一次（沿用 item-expiration job 既有
// CRON_SECRET 驗證慣例）。
//
// cursor 設計：不新增額外的 cursor 表，直接沿用 SystemJobRun.detail（既有 Json? 欄位）存
// {"cursor": {"publishedAt": "...", "id": "..."}}；每次執行先讀最近一筆 status='success' 的
// detail.cursor，撈 items.status='published' AND (published_at, id) > cursor（依
// published_at asc, id asc 排序，一批最多 500 筆）。首次上線（沒有任何成功執行過的紀錄）：
// cursor 起點 = 上線當下，不回溯掃描既有已上架物品。
//
// 關鍵前提（見 src/app/api/handover/[id]/no-show/route.ts、
// src/app/api/appeals/[id]/route.ts 的對應修改）：物品從 reserved/handover_pending/
// removed_by_moderator 退回 published 時，必須把 publishedAt 更新為 now()，否則舊的
// publishedAt 會小於 cursor 已經前進的位置，這次「重新上架」永遠不會被這支 job 掃到。
const JOB_KEY = "subscription_match_scan";
const BATCH_LIMIT = 500;

type StoredCursor = { publishedAt: string; id: string };

function readCursor(detail: unknown): StoredCursor | null {
  if (!detail || typeof detail !== "object") return null;
  const raw = (detail as Record<string, unknown>).cursor;
  if (!raw || typeof raw !== "object") return null;
  const publishedAt = (raw as Record<string, unknown>).publishedAt;
  const id = (raw as Record<string, unknown>).id;
  if (typeof publishedAt !== "string" || typeof id !== "string") return null;
  return { publishedAt, id };
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "訂閱條件比對排程掃描（master-plan §6a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const lastSuccess = await db.systemJobRun.findFirst({
      where: { jobId: job.id, status: "success", id: { not: run.id } },
      orderBy: { startedAt: "desc" },
      select: { detail: true },
    });
    const cursor = readCursor(lastSuccess?.detail);
    const now = new Date();

    const candidates = cursor
      ? await db.item.findMany({
          where: {
            status: "published",
            publishedAt: { not: null },
            OR: [
              { publishedAt: { gt: new Date(cursor.publishedAt) } },
              { publishedAt: new Date(cursor.publishedAt), id: { gt: cursor.id } },
            ],
          },
          orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
          take: BATCH_LIMIT,
          select: {
            id: true,
            title: true,
            description: true,
            categoryId: true,
            cityId: true,
            publishedAt: true,
            city: { select: { name: true } },
          },
        })
      : [];

    const subscriptions = await db.userSubscription.findMany({
      include: { keywords: true, categories: true, cities: true },
    });

    let matchedCount = 0;
    let notifiedCount = 0;

    for (const item of candidates) {
      const normalizedItemText = buildNormalizedItemText(item.title, item.description);
      for (const subscription of subscriptions) {
        if (!isMatch(subscription, item, normalizedItemText)) continue;

        const outcome = await processMatch(subscription, item);
        if (outcome.created) {
          matchedCount++;
          if (outcome.notifiedImmediate) notifiedCount++;
        }
      }
    }

    const last = candidates[candidates.length - 1];
    const newCursor: StoredCursor = last
      ? { publishedAt: last.publishedAt!.toISOString(), id: last.id }
      : (cursor ?? { publishedAt: now.toISOString(), id: "" });

    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        detail: { cursor: newCursor, scannedItems: candidates.length, matchedCount, notifiedCount },
      },
    });

    return NextResponse.json({
      jobRunId: run.id,
      scannedItems: candidates.length,
      matchedCount,
      notifiedCount,
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

type SubscriptionWithRelations = Prisma.UserSubscriptionGetPayload<{
  include: { keywords: true; categories: true; cities: true };
}>;

type CandidateItem = {
  id: string;
  title: string;
  categoryId: string;
  cityId: string;
  city: { name: string };
};

/**
 * 對單一 (subscription, item) pair 做「同物品同訂閱只通知一次」的 idempotent 寫入
 * （master-plan §6a 交付內容 7）：`subscription_matches` 的 `@@unique([subscriptionId,
 * itemId])` 是核心，撞到就代表這個 pair 已經處理過（例如 job 因故被重複觸發、cursor 還沒
 * 推進），直接跳過，不重複發通知。
 *
 * 新插入成功且 `immediateEnabled=true` 時，在同一個 transaction 裡立刻建立通知並蓋章
 * `notifiedAt`/`notifiedVia='immediate'`；`immediateEnabled=false` 則留給每日摘要 job。
 * Web Push 外部派送涉及網路呼叫，刻意放在 transaction 之外執行。
 */
async function processMatch(
  subscription: SubscriptionWithRelations,
  item: CandidateItem,
): Promise<{ created: boolean; notifiedImmediate: boolean }> {
  // 用物件包一層而不是裸的 let 變數：await 的巢狀 closure 內重新賦值後，TypeScript 對
  // closure 外部裸 let 變數的窄化推斷在這個寫法下會出現非預期結果，物件屬性賦值沒有這個問題。
  const box: { notifyOutcome: { notificationId: string; externalEnabled: boolean } | null } = {
    notifyOutcome: null,
  };
  let created = false;
  let notifiedImmediate = false;

  try {
    await db.$transaction(async (tx) => {
      const match = await tx.subscriptionMatch.create({
        data: { subscriptionId: subscription.id, itemId: item.id },
      });
      created = true;

      if (subscription.immediateEnabled) {
        notifiedImmediate = true;
        box.notifyOutcome = await createSubscriptionNotificationIfEnabled(tx, {
          userId: subscription.userId,
          eventType: "subscription_match",
          payload: {
            kind: "subscription_match",
            subscriptionId: subscription.id,
            subscriptionLabel: subscription.label ?? null,
            itemId: item.id,
            itemTitle: item.title,
            itemCityName: item.city.name,
          },
        });
        await tx.subscriptionMatch.update({
          where: { id: match.id },
          data: { notifiedAt: new Date(), notifiedVia: "immediate" },
        });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { created: false, notifiedImmediate: false };
    }
    throw e;
  }

  if (notifiedImmediate && box.notifyOutcome) {
    await dispatchWebPushForNotification({
      userId: subscription.userId,
      notificationId: box.notifyOutcome.notificationId,
      externalEnabled: box.notifyOutcome.externalEnabled,
      pushPayload: {
        title: "訂閱通知：有新物品上架了",
        body: `你訂閱的「${subscription.label ?? "條件"}」有新物品：${item.title}`,
        itemUrl: `/items/${item.id}`,
      },
    });
  }

  return { created, notifiedImmediate };
}
