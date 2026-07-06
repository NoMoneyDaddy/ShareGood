import type { RetentionAction } from "@/generated/prisma/enums";
import { COUPON_CATEGORY_SLUG, EXPIRING_FOOD_CATEGORY_SLUG } from "@/lib/categories";
import { db } from "@/lib/db";
import { filterUnderLegalHold } from "@/lib/legal-hold";
import { deleteObject } from "@/lib/storage";

// Retention 政策執行（master-plan §7a 交付內容 4）：`data_retention_policies` 是「可設定的
// 執行依據」，天數/動作不寫死在程式碼常數裡——這裡的 DEFAULT_RETENTION_POLICIES 只是給
// `prisma/seed.ts` 用的初始值，之後後台改一筆設定即可生效，不需要改程式碼。
//
// ⚠️ 法律免責聲明：以下建議天數僅為技術實作參考，不構成法律意見；正式營運前需台灣律師與
// 平台法務審閱（見 master-plan.md §7a 節首與節尾聲明，尤其 retention 期限表一節）。
//
// 與規格文件的一個對齊修正：規格建議 seed 表裡 `item_metadata_public`／`law_enforcement_exports`
// 兩列同時列了 `retention_days=null` 又給了 `action=archive`，但同一份規格在 `data_retention_policies`
// 欄位定義處明確要求「retention_days 為 null 時 action 也必須是 null，兩者同時為 null 才合法」
// （用 `retention_days IS NOT NULL` 當作 job 判斷要不要處理的依據）。兩段互相矛盾，這裡採用
// 欄位定義那段的明確規則（有具體理由：避免 job 誤把「不清理」政策的 action 值當真），
// 把這兩列的 action 存成 null，「archive」只當作文件註解裡的說明語意，不寫進 DB 欄位。
export const DEFAULT_RETENTION_POLICIES: Array<{
  policyKey: string;
  description: string;
  retentionDays: number | null;
  action: RetentionAction | null;
}> = [
  {
    policyKey: "item_metadata_public",
    description: "公開物品 metadata（長期保留/封存，不自動清理）",
    retentionDays: null,
    action: null,
  },
  {
    policyKey: "item_images_completed",
    description: "已完成物品圖片：只留縮圖，刪除中大尺寸圖片",
    retentionDays: 180,
    action: "downgrade",
  },
  {
    policyKey: "item_images_coupon_expired",
    description: "過期優惠券圖片：完全清除",
    retentionDays: 120,
    action: "purge",
  },
  {
    policyKey: "item_images_perishable_expired",
    description: "即期好物過期圖片：完全清除（Item/ItemImage 紀錄本身保留）",
    retentionDays: 90,
    action: "purge",
  },
  {
    policyKey: "messages_after_completion",
    description: "私訊（完成共享後）：歸檔標記，爭議中或 legal hold 不處理",
    retentionDays: 90,
    action: "archive",
  },
  {
    policyKey: "notifications",
    description: "站內通知：完全清除",
    retentionDays: 90,
    action: "purge",
  },
  {
    policyKey: "telegram_raw_updates",
    description: "Telegram raw update 去重紀錄：完全清除",
    retentionDays: 14,
    action: "purge",
  },
  {
    policyKey: "web_push_endpoints_inactive",
    description: "失效的 Web Push endpoint：失效即清除（非時間制，retention_days=0）",
    retentionDays: 0,
    action: "purge",
  },
  {
    policyKey: "report_appeal_evidence",
    description: "已結案檢舉／申訴的證據圖片：完全清除",
    retentionDays: 270,
    action: "purge",
  },
  {
    policyKey: "audit_logs",
    description: "稽核紀錄：長期保留，不自動清理",
    retentionDays: null,
    action: null,
  },
  {
    policyKey: "sensitive_access_logs",
    description: "敏感調閱紀錄（audit_logs 中 sensitive=true 者）：長期保留，不自動清理",
    retentionDays: null,
    action: null,
  },
  {
    policyKey: "data_exports",
    description: "資料匯出包：產生後保留天數（供 data-export-generate job 計算 expiresAt 使用）",
    retentionDays: 7,
    action: "purge",
  },
  {
    policyKey: "law_enforcement_exports",
    description: "警方/檢調調閱匯出包：依案件另訂，不自動清理（由 legal hold 保護避免誤刪）",
    retentionDays: null,
    action: null,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 5000;

export type PolicyRunResult = { processed: number; skipped: number; note?: string };

/**
 * 批次刪除（`purge`）通用流程：候選 id 用「以 `id` 遞增的游標」分批處理（每批最多
 * BATCH_SIZE 筆），避免單次 `DELETE ... WHERE id IN (...)` 無上限鎖表太久；每批先用一次
 * `IN` 查詢批次檢查 legal hold（不逐筆查，見 master-plan §7a 交付內容 4 對 N+1 的明確要求），
 * 命中的跳過但不刪除。
 *
 * 游標無論這一批「是否有任何一筆真的被刪除」都會往前推進（`lastId` 取這批最後一筆的 id）——
 * 修正先前版本的兩個問題：(1) 如果整批候選剛好全部被 legal hold 擋下就直接 `break`，會讓
 * 排在後面、沒被保全的候選永遠輪不到清理；(2) 如果分批查詢條件本身不帶游標（每次重查
 * 「還沒被刪除的前 N 筆」），命中整批 legal hold 時候選集合不會縮小，下一輪查到一模一樣的
 * 資料，會無窮迴圈。改用穩定的 `id` 游標後，兩個問題都不會發生：游標永遠往前走，最多跑
 * ceil(候選數／BATCH_SIZE) 輪就會结束。
 */
async function purgeSimpleRows(params: {
  policyKey: string;
  targetType: string;
  jobRunId: string;
  action: RetentionAction;
  findCandidateIds: (limit: number, lastId?: string) => Promise<string[]>;
  deleteByIds: (ids: string[]) => Promise<void>;
}): Promise<PolicyRunResult> {
  let processed = 0;
  let skipped = 0;
  let lastId: string | undefined;
  for (;;) {
    const ids = await params.findCandidateIds(BATCH_SIZE, lastId);
    if (ids.length === 0) break;
    lastId = ids[ids.length - 1];

    const heldIds = await filterUnderLegalHold(params.targetType, ids);
    const freeIds = ids.filter((id) => !heldIds.has(id));

    if (freeIds.length > 0) await params.deleteByIds(freeIds);

    await db.dataPurgeLog.createMany({
      data: ids.map((id) => ({
        policyKey: params.policyKey,
        jobRunId: params.jobRunId,
        targetType: params.targetType,
        targetId: id,
        actionTaken: params.action,
        skippedLegalHold: heldIds.has(id),
      })),
    });

    processed += freeIds.length;
    skipped += heldIds.size;

    if (ids.length < BATCH_SIZE) break;
  }
  return { processed, skipped };
}

async function runNotificationsPurge(retentionDays: number, jobRunId: string) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  return purgeSimpleRows({
    policyKey: "notifications",
    targetType: "notification",
    jobRunId,
    action: "purge",
    findCandidateIds: async (limit, lastId) =>
      (
        await db.notification.findMany({
          where: { createdAt: { lt: cutoff }, ...(lastId ? { id: { gt: lastId } } : {}) },
          select: { id: true },
          orderBy: { id: "asc" },
          take: limit,
        })
      ).map((r) => r.id),
    deleteByIds: async (ids) => {
      await db.notification.deleteMany({ where: { id: { in: ids } } });
    },
  });
}

async function runTelegramRawUpdatesPurge(retentionDays: number, jobRunId: string) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  return purgeSimpleRows({
    policyKey: "telegram_raw_updates",
    targetType: "telegram_update",
    jobRunId,
    action: "purge",
    findCandidateIds: async (limit, lastId) =>
      (
        await db.telegramUpdate.findMany({
          where: { createdAt: { lt: cutoff }, ...(lastId ? { id: { gt: lastId } } : {}) },
          select: { id: true },
          orderBy: { id: "asc" },
          take: limit,
        })
      ).map((r) => r.id),
    deleteByIds: async (ids) => {
      await db.telegramUpdate.deleteMany({ where: { id: { in: ids } } });
    },
  });
}

async function runWebPushInactivePurge(_retentionDays: number, jobRunId: string) {
  // retentionDays=0：「失效即刪，非時間制」，不看時間、只看 isActive=false。
  return purgeSimpleRows({
    policyKey: "web_push_endpoints_inactive",
    targetType: "web_push_subscription",
    jobRunId,
    action: "purge",
    findCandidateIds: async (limit, lastId) =>
      (
        await db.webPushSubscription.findMany({
          where: { isActive: false, ...(lastId ? { id: { gt: lastId } } : {}) },
          select: { id: true },
          orderBy: { id: "asc" },
          take: limit,
        })
      ).map((r) => r.id),
    deleteByIds: async (ids) => {
      await db.webPushSubscription.deleteMany({ where: { id: { in: ids } } });
    },
  });
}

// downgrade：已完成物品的圖片只留縮圖（thumb），刪除中尺寸圖（medium）。ItemImage 列本身、
// thumbObjectId 都不動；只把 mediumObject 標記 deleted 並清掉 MinIO 上的實體檔案（跟既有
// storage-cleanup job 對 StorageObject 的處理方式一致：不刪列，只標記＋清實體檔案）。
async function runItemImagesCompletedDowngrade(retentionDays: number, jobRunId: string) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  let processed = 0;
  let skipped = 0;
  let lastId: string | undefined;
  for (;;) {
    const candidates = await db.itemImage.findMany({
      where: {
        item: { status: "completed", handoverRecord: { completedAt: { lte: cutoff } } },
        mediumObject: { status: { not: "deleted" } },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      select: {
        id: true,
        mediumObjectId: true,
        mediumObject: { select: { objectKey: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    lastId = candidates[candidates.length - 1].id;

    const ids = candidates.map((c) => c.id);
    const heldIds = await filterUnderLegalHold("item_image", ids);
    const freeCandidates = candidates.filter((c) => !heldIds.has(c.id));

    for (const c of freeCandidates) {
      await deleteObject(c.mediumObject.objectKey).catch(() => {
        /* MinIO 上已不存在也視為清理成功，比照既有孤兒檔清理 job 的容錯方式 */
      });
      await db.storageObject.update({
        where: { id: c.mediumObjectId },
        data: { status: "deleted", deletedAt: new Date() },
      });
    }

    await db.dataPurgeLog.createMany({
      data: ids.map((id) => ({
        policyKey: "item_images_completed",
        jobRunId,
        targetType: "item_image",
        targetId: id,
        actionTaken: "downgrade",
        skippedLegalHold: heldIds.has(id),
      })),
    });

    processed += freeCandidates.length;
    skipped += heldIds.size;
    if (candidates.length < BATCH_SIZE) break;
  }
  return { processed, skipped };
}

// purge：過期優惠券／即期好物圖片完全清除（thumb+medium 都刪實體檔案），Item/ItemImage
// 紀錄本身保留（見規格「僅刪圖片，列本身保留」）。用分類 slug 區分兩個政策鎖定的物品範圍。
async function runItemImagesPurgeByCategory(params: {
  policyKey: string;
  categorySlug: string;
  retentionDays: number;
  jobRunId: string;
}) {
  const cutoff = new Date(Date.now() - params.retentionDays * DAY_MS);
  let processed = 0;
  let skipped = 0;
  let lastId: string | undefined;
  for (;;) {
    const candidates = await db.itemImage.findMany({
      where: {
        item: {
          status: "expired",
          category: { slug: params.categorySlug },
          expiresAt: { lte: cutoff },
        },
        OR: [
          { thumbObject: { status: { not: "deleted" } } },
          { mediumObject: { status: { not: "deleted" } } },
        ],
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      select: {
        id: true,
        thumbObjectId: true,
        thumbObject: { select: { objectKey: true, status: true } },
        mediumObjectId: true,
        mediumObject: { select: { objectKey: true, status: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    lastId = candidates[candidates.length - 1].id;

    const ids = candidates.map((c) => c.id);
    const heldIds = await filterUnderLegalHold("item_image", ids);
    const freeCandidates = candidates.filter((c) => !heldIds.has(c.id));

    for (const c of freeCandidates) {
      if (c.thumbObject.status !== "deleted") {
        await deleteObject(c.thumbObject.objectKey).catch(() => {});
        await db.storageObject.update({
          where: { id: c.thumbObjectId },
          data: { status: "deleted", deletedAt: new Date() },
        });
      }
      if (c.mediumObject.status !== "deleted") {
        await deleteObject(c.mediumObject.objectKey).catch(() => {});
        await db.storageObject.update({
          where: { id: c.mediumObjectId },
          data: { status: "deleted", deletedAt: new Date() },
        });
      }
    }

    await db.dataPurgeLog.createMany({
      data: ids.map((id) => ({
        policyKey: params.policyKey,
        jobRunId: params.jobRunId,
        targetType: "item_image",
        targetId: id,
        actionTaken: "purge",
        skippedLegalHold: heldIds.has(id),
      })),
    });

    processed += freeCandidates.length;
    skipped += heldIds.size;
    if (candidates.length < BATCH_SIZE) break;
  }
  return { processed, skipped };
}

// archive：目前架構沒有獨立的冷儲存/歸檔基礎建設，「歸檔」在這裡只代表「政策判定為到期、
// 且不是 legal hold 命中」，實際上不對 Message 列做任何刪除或搬移，只寫一筆 data_purge_logs
// 標記已處理過（action_taken=archive）。之所以仍要跑批次 legal hold 檢查，是因為未來如果
// 真的接上歸檔基礎建設，這裡的骨架就是直接可用的；現階段這是保守選擇（message 本身可能是
// 未來糾紛調解的證據，寧可不動它）。
async function runMessagesAfterCompletionArchive(retentionDays: number, jobRunId: string) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  let processed = 0;
  let skipped = 0;
  for (;;) {
    const ids = (
      await db.message.findMany({
        where: {
          createdAt: { lt: cutoff },
          conversation: { item: { handoverRecord: { completedAt: { lte: cutoff } } } },
        },
        select: { id: true },
        take: BATCH_SIZE,
      })
    ).map((m) => m.id);
    if (ids.length === 0) break;

    const heldIds = await filterUnderLegalHold("message", ids);

    await db.dataPurgeLog.createMany({
      data: ids.map((id) => ({
        policyKey: "messages_after_completion",
        jobRunId,
        targetType: "message",
        targetId: id,
        actionTaken: "archive",
        skippedLegalHold: heldIds.has(id),
      })),
    });

    processed += ids.length - heldIds.size;
    skipped += heldIds.size;
    // archive 不刪資料，候選集合不會因為這次處理而縮小，必須主動跳出避免每次都重新處理
    // 同一批（用 data_purge_logs 是否已存在同一 targetId 來判斷「已歸檔過」不在本次範圍，
    // 見程式碼上方註解——這裡選擇每次執行都視為「重新確認」，只執行一批就結束，不迴圈）。
    break;
  }
  return { processed, skipped };
}

// purge：已結案檢舉／申訴的證據圖片完全清除實體檔案（ReportEvidence/AppealEvidence 列本身
// 保留，storageObject 對它們是 onDelete: Restrict，本來就不能真的刪列）。legal hold 用
// 「報告/申訴本身」當保全單位：整份報告被保全時，底下所有證據都不動。
async function runReportAppealEvidencePurge(retentionDays: number, jobRunId: string) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  let processed = 0;
  let skipped = 0;
  // 兩張表各自獨立分頁（各自的候選集合、各自的游標），因為 report_evidence／
  // appeal_evidence 是兩個不相關的來源，共用一個游標會讓其中一邊提早被跳過。
  let lastReportEvidenceId: string | undefined;
  let lastAppealEvidenceId: string | undefined;

  for (;;) {
    const reportEvidence = await db.reportEvidence.findMany({
      where: {
        report: { status: { in: ["resolved", "rejected", "closed"] }, updatedAt: { lte: cutoff } },
        storageObject: { status: { not: "deleted" } },
        ...(lastReportEvidenceId ? { id: { gt: lastReportEvidenceId } } : {}),
      },
      select: {
        id: true,
        reportId: true,
        storageObjectId: true,
        storageObject: { select: { objectKey: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    const appealEvidence = await db.appealEvidence.findMany({
      where: {
        appeal: { status: { in: ["approved", "rejected"] }, reviewedAt: { lte: cutoff } },
        storageObject: { status: { not: "deleted" } },
        ...(lastAppealEvidenceId ? { id: { gt: lastAppealEvidenceId } } : {}),
      },
      select: {
        id: true,
        appealId: true,
        storageObjectId: true,
        storageObject: { select: { objectKey: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (reportEvidence.length === 0 && appealEvidence.length === 0) break;
    if (reportEvidence.length > 0) {
      lastReportEvidenceId = reportEvidence[reportEvidence.length - 1].id;
    }
    if (appealEvidence.length > 0) {
      lastAppealEvidenceId = appealEvidence[appealEvidence.length - 1].id;
    }

    const reportHeldIds = await filterUnderLegalHold(
      "report",
      Array.from(new Set(reportEvidence.map((e) => e.reportId))),
    );
    const appealHeldIds = await filterUnderLegalHold(
      "appeal",
      Array.from(new Set(appealEvidence.map((e) => e.appealId))),
    );

    const purgeLogRows: Array<{
      policyKey: string;
      jobRunId: string;
      targetType: string;
      targetId: string;
      actionTaken: RetentionAction;
      skippedLegalHold: boolean;
    }> = [];

    for (const e of reportEvidence) {
      const held = reportHeldIds.has(e.reportId);
      if (!held) {
        await deleteObject(e.storageObject.objectKey).catch(() => {});
        await db.storageObject.update({
          where: { id: e.storageObjectId },
          data: { status: "deleted", deletedAt: new Date() },
        });
        processed++;
      } else {
        skipped++;
      }
      purgeLogRows.push({
        policyKey: "report_appeal_evidence",
        jobRunId,
        targetType: "report_evidence",
        targetId: e.id,
        actionTaken: "purge",
        skippedLegalHold: held,
      });
    }

    for (const e of appealEvidence) {
      const held = appealHeldIds.has(e.appealId);
      if (!held) {
        await deleteObject(e.storageObject.objectKey).catch(() => {});
        await db.storageObject.update({
          where: { id: e.storageObjectId },
          data: { status: "deleted", deletedAt: new Date() },
        });
        processed++;
      } else {
        skipped++;
      }
      purgeLogRows.push({
        policyKey: "report_appeal_evidence",
        jobRunId,
        targetType: "appeal_evidence",
        targetId: e.id,
        actionTaken: "purge",
        skippedLegalHold: held,
      });
    }

    if (purgeLogRows.length > 0) await db.dataPurgeLog.createMany({ data: purgeLogRows });

    if (reportEvidence.length < BATCH_SIZE && appealEvidence.length < BATCH_SIZE) break;
  }

  return { processed, skipped };
}

type PolicyHandler = (retentionDays: number, jobRunId: string) => Promise<PolicyRunResult>;

// 只有「有實際可執行動作」的政策才需要 handler；retentionDays=null 的政策（長期保留）
// 在 runRetentionPurgeJob 裡就被過濾掉，不會走到這裡。`data_exports` 的到期清除走獨立的
// data-export-purge job（見 §7a 交付內容 2），不在這裡重複處理，避免兩支 job 對同一批
// 資料互搶。任何未知/未實作的 policyKey（例如未來後台新增的自訂政策）一律安全跳過並記錄
// note，不讓整個 job 因為一個不認識的政策而失敗。
const POLICY_HANDLERS: Record<string, PolicyHandler> = {
  notifications: runNotificationsPurge,
  telegram_raw_updates: runTelegramRawUpdatesPurge,
  web_push_endpoints_inactive: runWebPushInactivePurge,
  item_images_completed: runItemImagesCompletedDowngrade,
  item_images_coupon_expired: (days, jobRunId) =>
    runItemImagesPurgeByCategory({
      policyKey: "item_images_coupon_expired",
      categorySlug: COUPON_CATEGORY_SLUG,
      retentionDays: days,
      jobRunId,
    }),
  item_images_perishable_expired: (days, jobRunId) =>
    runItemImagesPurgeByCategory({
      policyKey: "item_images_perishable_expired",
      categorySlug: EXPIRING_FOOD_CATEGORY_SLUG,
      retentionDays: days,
      jobRunId,
    }),
  messages_after_completion: runMessagesAfterCompletionArchive,
  report_appeal_evidence: runReportAppealEvidencePurge,
};

/**
 * 執行一次 retention_purge job：走過所有 `is_active=true` 且 `retention_days IS NOT NULL`
 * 的政策，依 policyKey 分派到對應 handler；天數／要不要處理完全依資料庫當下的設定決定，
 * 不寫死在程式碼常數裡（改一筆政策設定，下次執行就用新數字）。
 */
export async function runRetentionPurgeJob(
  jobRunId: string,
): Promise<Record<string, PolicyRunResult>> {
  const policies = await db.dataRetentionPolicy.findMany({
    where: { isActive: true, retentionDays: { not: null } },
  });

  const results: Record<string, PolicyRunResult> = {};
  for (const policy of policies) {
    const handler = POLICY_HANDLERS[policy.policyKey];
    if (!handler) {
      results[policy.policyKey] = { processed: 0, skipped: 0, note: "沒有對應的執行邏輯，已跳過" };
      continue;
    }
    // retentionDays 已由上方 where 條件排除 null，此處必為 number。
    results[policy.policyKey] = await handler(policy.retentionDays as number, jobRunId);
  }
  return results;
}
