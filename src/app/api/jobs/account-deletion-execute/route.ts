import { type NextRequest, NextResponse } from "next/server";
import { deidentifyUser } from "@/lib/account-deletion";
import { jsonError } from "@/lib/api";
import { db } from "@/lib/db";
import { isUnderLegalHold } from "@/lib/legal-hold";
import { createOrMergeNotification } from "@/lib/notifications";

// account_deletion_execute job（master-plan §7a 交付內容 3）：由外部 cron 以
// Authorization: Bearer ${CRON_SECRET} 每日觸發。掃描 PrivacyRequest
// (type=account_deletion, status=cooling_off, coolingOffUntil<=now())，對每筆先檢查
// isUnderLegalHold("user", userId)：
// - 命中：privacy_requests 轉 rejected（不執行去識別化），寫 audit log（系統判斷，
//   不揭露案件細節），通知使用者「因法律程序原因暫無法刪除」。
// - 未命中：在同一個 transaction 內執行去識別化改寫（deidentifyUser），privacy_requests
//   轉 completed，寫 audit log（action=user.account_deleted, sensitive=true）。
//
// ⚠️ 法律免責聲明：legal hold 命中時是否要揭露更多案件細節給當事人，屬法律專業判斷，本
// job 刻意只給「因法律程序原因暫無法刪除」這種不揭露細節的通用訊息，正式營運前需台灣律師
// 與平台法務審閱（見 master-plan.md §7a 節首聲明）。
const JOB_KEY = "account_deletion_execute";
const BATCH_LIMIT = 100;

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return jsonError("UNAUTHORIZED", "無效的 cron token");
  }

  const job = await db.systemJob.upsert({
    where: { key: JOB_KEY },
    update: {},
    create: { key: JOB_KEY, description: "帳號刪除冷卻期到期執行去識別化（master-plan §7a）" },
  });
  const run = await db.systemJobRun.create({ data: { jobId: job.id, status: "running" } });

  let executed = 0;
  let blockedByLegalHold = 0;
  try {
    const now = new Date();
    const dueRequests = await db.privacyRequest.findMany({
      where: { type: "account_deletion", status: "cooling_off", coolingOffUntil: { lte: now } },
      take: BATCH_LIMIT,
    });

    for (const request of dueRequests) {
      // 條件式 updateMany 當樂觀鎖，避免同一筆請求被重複觸發的 job 執行兩次。
      const claimed = await db.privacyRequest.updateMany({
        where: { id: request.id, status: "cooling_off" },
        data: { status: "processing" },
      });
      if (claimed.count === 0) continue;

      const held = await isUnderLegalHold("user", request.userId);
      if (held) {
        blockedByLegalHold++;
        await db.$transaction(async (tx) => {
          await tx.privacyRequest.update({
            where: { id: request.id },
            data: { status: "rejected" },
          });
          await tx.auditLog.create({
            data: {
              actorId: null,
              action: "privacy_request.account_deletion_blocked_legal_hold",
              targetType: "user",
              targetId: request.userId,
              detail: { privacyRequestId: request.id },
              sensitive: true,
            },
          });
          await createOrMergeNotification(tx, {
            userId: request.userId,
            type: "completion_confirmed",
            payload: { kind: "account_deletion_blocked_legal_hold" },
          });
        });
        continue;
      }

      await db.$transaction(async (tx) => {
        await deidentifyUser(tx, request.userId, now);
        await tx.privacyRequest.update({
          where: { id: request.id },
          data: { status: "completed", completedAt: now },
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "user.account_deleted",
            targetType: "user",
            targetId: request.userId,
            detail: { privacyRequestId: request.id },
            sensitive: true,
          },
        });
      });
      executed++;
    }

    await db.systemJobRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), detail: { executed, blockedByLegalHold } },
    });
    return NextResponse.json({ jobRunId: run.id, executed, blockedByLegalHold });
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
