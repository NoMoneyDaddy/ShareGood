import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  DISPATCH_BATCH_LIMIT,
  DISPATCH_LOOKBACK_HOURS,
  dispatchPendingNotifications,
} from "@/lib/notification-dispatch";

// 外部通知「初次發送」掃描 job（補 M4 遺留缺口）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 定期觸發（沿用 item-expiration／subscription-match-scan
// 既有 CRON_SECRET 驗證慣例，建議每 1–2 分鐘一次）。掃描邏輯與防重複發送見
// src/lib/notification-dispatch.ts。
//
// 首次執行 watermark（避免上線瞬間把 lookback 窗口內既有的歷史通知一次全部外送）：
// 把「本 job 第一次成功執行的時間」存進 SystemJobRun.detail.watermark，並在之後每次執行
// 原樣帶下去。掃描下界 since = max(watermark, now - LOOKBACK)：
// - 第一次執行：沒有 watermark，記下 watermark=now 且本次不派送（since=now，掃不到任何
//   既有通知），純粹立樁。之後的通知才會被派送。
// - 之後每次：watermark 通常早於 now - LOOKBACK，所以 now - LOOKBACK 主導，等同「只送最近
//   LOOKBACK 小時、且尚未送過的通知」。watermark 只在上線後頭 LOOKBACK 小時內起作用。
const JOB_KEY = "notification_dispatch";
const LOOKBACK_MS = DISPATCH_LOOKBACK_HOURS * 60 * 60 * 1000;

function readWatermark(detail: unknown): Date | null {
  if (!detail || typeof detail !== "object") return null;
  const raw = (detail as Record<string, unknown>).watermark;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "外部通知初次發送掃描（補 M4 遺留缺口）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  try {
    const now = new Date();
    const lastSuccess = await db.systemJobRun.findFirst({
      where: { jobId: job.id, status: "success", id: { not: run.id } },
      orderBy: { startedAt: "desc" },
      select: { detail: true },
    });
    const watermark = readWatermark(lastSuccess?.detail);

    if (!watermark) {
      // 首次執行：立樁，不派送任何既有通知。
      await db.systemJobRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          detail: { watermark: now.toISOString(), firstRun: true, scanned: 0 },
        },
      });
      return NextResponse.json({ jobRunId: run.id, firstRun: true, scanned: 0 });
    }

    const lookbackFloor = new Date(now.getTime() - LOOKBACK_MS);
    const since = watermark.getTime() > lookbackFloor.getTime() ? watermark : lookbackFloor;

    const summary = await dispatchPendingNotifications({ since, batchLimit: DISPATCH_BATCH_LIMIT });

    await db.systemJobRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        // watermark 原樣帶下去（維持上線立樁時間），since 另記供除錯。
        detail: { watermark: watermark.toISOString(), since: since.toISOString(), ...summary },
      },
    });

    return NextResponse.json({ jobRunId: run.id, ...summary });
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
