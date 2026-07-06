import { createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createOrMergeNotification } from "@/lib/notifications";

// M5 抽籤（master-plan §5a）共用邏輯：開獎演算法、開獎/遞補的原子操作。
// 集中放這裡讓 job route（src/app/api/jobs/lottery-draw/route.ts）與即時婉拒
// （src/app/api/lotteries/[id]/decline/route.ts）共用同一段「空出目前順位→找下一位遞補」
// 邏輯，避免兩處各自實作、行為不一致。

export const CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 小時
export const ALGO_VERSION = "hmac-sha256-fisher-yates-v1";

const ACTIVE_LOTTERY_STATUSES = ["open", "drawing", "awaiting_confirmation"] as const;

/** 該物品是否存在非終態抽籤（用於留言/直贈的 409 衝突檢查，見交付內容 2）。 */
export async function hasActiveLottery(itemId: string): Promise<boolean> {
  const lottery = await db.lottery.findUnique({ where: { itemId }, select: { status: true } });
  return !!lottery && (ACTIVE_LOTTERY_STATUSES as readonly string[]).includes(lottery.status);
}

/**
 * 決定性洗牌（master-plan §5a 交付內容 4）：用 seed 當 HMAC 金鑰、遞增計數器當訊息，
 * 逐步取代 Fisher-Yates 洗牌演算法裡的隨機索引。只要重新輸入同一組
 * (seed, entryIds)，任何人都能獨立算出一模一樣的排列，讓「重演驗證」有意義。
 * `% (i + 1)` 存在極輕微 modulo bias，在正常報名規模下可忽略（規格已載明）。
 */
export function deterministicShuffle(entryIds: string[], seedHex: string): string[] {
  const arr = [...entryIds];
  const key = Buffer.from(seedHex, "hex");
  let counter = 0;
  for (let i = arr.length - 1; i > 0; i--) {
    const digest = createHmac("sha256", key)
      .update(Buffer.from(String(counter++)))
      .digest();
    const j = digest.readUInt32BE(0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type DrawOutcome = "drawn" | "failed_no_entries" | "skipped";

/**
 * 對單一抽籤執行開獎（job 用，見交付內容 5-a）。
 *
 * 併發保護：用 `status='open'` 的條件式 updateMany 當樂觀鎖搶下這筆抽籤的處理權
 * （open → drawing），0 rows affected 代表已經被別次執行搶走，直接回傳 "skipped"
 * no-op，不重複開獎。這是逐筆（per-lottery）樂觀鎖，不同抽籤之間互不阻塞（見規格
 * 「關於 job lock 定案決策的技術選型澄清」）。
 */
export async function drawLottery(lotteryId: string, now: Date): Promise<DrawOutcome> {
  const locked = await db.lottery.updateMany({
    where: { id: lotteryId, status: "open" },
    data: { status: "drawing" },
  });
  if (locked.count === 0) return "skipped";

  await db.lotteryAuditLog.create({
    data: { lotteryId, action: "draw_started", actorId: null },
  });

  const [entries, lottery] = await Promise.all([
    db.lotteryEntry.findMany({
      where: { lotteryId, status: "entered" },
      orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
      select: { id: true, userId: true },
    }),
    db.lottery.findUniqueOrThrow({
      where: { id: lotteryId },
      include: { item: { select: { id: true, title: true } } },
    }),
  ]);

  if (entries.length === 0) {
    await db.$transaction(async (tx) => {
      await tx.lottery.update({ where: { id: lotteryId }, data: { status: "failed_no_entries" } });
      await tx.lotteryAuditLog.create({
        data: { lotteryId, action: "draw_failed_no_entries", actorId: null },
      });
      await createOrMergeNotification(tx, {
        userId: lottery.creatorId,
        type: "completion_confirmed",
        payload: { itemId: lottery.item.id, itemTitle: lottery.item.title, kind: "lottery_failed" },
      });
    });
    return "failed_no_entries";
  }

  const seed = randomBytes(32).toString("hex");
  const entrySnapshot = entries.map((e) => e.id);
  const shuffled = deterministicShuffle(entrySnapshot, seed);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const offeredAt = now;
  const confirmDeadline = new Date(now.getTime() + CONFIRM_WINDOW_MS);

  await db.$transaction(async (tx) => {
    await tx.lottery.update({
      where: { id: lotteryId },
      data: {
        seed,
        entrySnapshot,
        algoVersion: ALGO_VERSION,
        drawnAt: now,
        currentRank: 1,
        status: "awaiting_confirmation",
      },
    });

    await tx.lotteryResult.createMany({
      data: shuffled.map((entryId, idx) => {
        const rank = idx + 1;
        const entry = entryById.get(entryId);
        if (!entry) throw new Error("LOTTERY_ENTRY_NOT_FOUND");
        return rank === 1
          ? {
              lotteryId,
              entryId,
              userId: entry.userId,
              rank,
              status: "offered" as const,
              offeredAt,
              confirmDeadline,
            }
          : { lotteryId, entryId, userId: entry.userId, rank, status: "pending" as const };
      }),
    });

    await tx.lotteryAuditLog.create({
      data: {
        lotteryId,
        action: "draw_completed",
        actorId: null,
        metadata: { entryCount: entries.length },
      },
    });

    const winnerUserId = entryById.get(shuffled[0])?.userId;
    if (!winnerUserId) throw new Error("LOTTERY_ENTRY_NOT_FOUND");

    await tx.lotteryAuditLog.create({
      data: {
        lotteryId,
        action: "rank_offered",
        actorId: null,
        metadata: { rank: 1, userId: winnerUserId },
      },
    });

    await createOrMergeNotification(tx, {
      userId: winnerUserId,
      type: "completion_confirmed",
      payload: {
        itemId: lottery.item.id,
        itemTitle: lottery.item.title,
        kind: "lottery_won",
        confirmDeadline: confirmDeadline.toISOString(),
      },
    });
    await createOrMergeNotification(tx, {
      userId: lottery.creatorId,
      type: "completion_confirmed",
      payload: { itemId: lottery.item.id, itemTitle: lottery.item.title, kind: "lottery_drawn" },
    });
  });

  return "drawn";
}

export type VacancyOutcome = "advanced" | "failed_no_entries" | "skipped";

/**
 * 空出目前順位（逾時或婉拒）並嘗試遞補下一位（master-plan §5a 交付內容 5-b／6）。
 * job 的「逾時遞補」與 `PATCH /api/lotteries/[id]/decline` 的「立即婉拒遞補」共用這段邏輯。
 *
 * 併發保護：先用 `updateMany({ where: { id: resultId, rank: expectedRank, status: "offered" }
 * })` 把這一列從 offered 轉成 expired/declined 當樂觀鎖——同一個 result 列只有一個呼叫端能
 * 真的搶到這次轉換（Postgres 對這個 UPDATE 陳述式本身的列鎖會讓併發的第二個 transaction
 * 等到第一個 commit 後才看到 status 已經不是 offered，count 變 0）。搶到之後才有資格判斷
 * 「往下找 rank+1」與寫入 `lotteries.currentRank`，因此不需要對 lottery 本身另外加鎖。
 */
export async function advanceLotteryVacancy(params: {
  lotteryId: string;
  expectedRank: number;
  resultId: string;
  newStatus: "expired" | "declined";
  now: Date;
  actorId: string | null;
}): Promise<VacancyOutcome> {
  const { lotteryId, expectedRank, resultId, newStatus, now, actorId } = params;

  return db.$transaction(async (tx) => {
    const claimed = await tx.lotteryResult.updateMany({
      where: { id: resultId, lotteryId, rank: expectedRank, status: "offered" },
      data: { status: newStatus, respondedAt: now },
    });
    if (claimed.count === 0) return "skipped";

    const lottery = await tx.lottery.findUniqueOrThrow({
      where: { id: lotteryId },
      include: { item: { select: { id: true, title: true } } },
    });

    await tx.lotteryAuditLog.create({
      data: {
        lotteryId,
        action: newStatus === "expired" ? "rank_expired" : "rank_declined",
        actorId,
        metadata: { rank: expectedRank },
      },
    });

    const nextResult = await tx.lotteryResult.findUnique({
      where: { lotteryId_rank: { lotteryId, rank: expectedRank + 1 } },
    });

    if (!nextResult) {
      await tx.lottery.updateMany({
        where: { id: lotteryId, status: "awaiting_confirmation" },
        data: { status: "failed_no_entries" },
      });
      await tx.lotteryAuditLog.create({
        data: { lotteryId, action: "draw_failed_no_entries", actorId: null },
      });
      await createOrMergeNotification(tx, {
        userId: lottery.creatorId,
        type: "completion_confirmed",
        payload: { itemId: lottery.item.id, itemTitle: lottery.item.title, kind: "lottery_failed" },
      });
      return "failed_no_entries";
    }

    const confirmDeadline = new Date(now.getTime() + CONFIRM_WINDOW_MS);
    await tx.lotteryResult.update({
      where: { id: nextResult.id },
      data: { status: "offered", offeredAt: now, confirmDeadline },
    });
    await tx.lottery.updateMany({
      where: { id: lotteryId, status: "awaiting_confirmation" },
      data: { currentRank: expectedRank + 1 },
    });
    await tx.lotteryAuditLog.create({
      data: {
        lotteryId,
        action: "rank_offered",
        actorId: null,
        metadata: { rank: expectedRank + 1, userId: nextResult.userId },
      },
    });

    await createOrMergeNotification(tx, {
      userId: nextResult.userId,
      type: "completion_confirmed",
      payload: {
        itemId: lottery.item.id,
        itemTitle: lottery.item.title,
        kind: "lottery_backup_offered",
        confirmDeadline: confirmDeadline.toISOString(),
      },
    });
    await createOrMergeNotification(tx, {
      userId: lottery.creatorId,
      type: "completion_confirmed",
      payload: { itemId: lottery.item.id, itemTitle: lottery.item.title, kind: "lottery_progress" },
    });

    return "advanced";
  });
}

/** 供整合測試／稽核重演使用的 transaction client 型別別名。 */
export type LotteryTx = Prisma.TransactionClient;
