import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * 管理操作與敏感調閱一律經過這裡寫 audit_logs（CLAUDE.md 硬規則 6）。
 * 在 $transaction 內呼叫時**必須**把 tx 當第二參數傳入：audit 若用全域 client 寫入，
 * 交易回滾時會留下幽靈稽核紀錄（對 deal_info.reactivate 這種拿 audit 筆數反推輪次的
 * 用法，幽靈紀錄會直接弄壞輪次計數）。
 */
export async function writeAudit(
  params: {
    actorId: string | null;
    action: string; // 例：user.role.grant / item.force_remove
    targetType: string;
    targetId?: string;
    detail?: Prisma.InputJsonValue;
    sensitive?: boolean;
  },
  client: Pick<PrismaClient, "auditLog"> = db,
) {
  await client.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail,
      sensitive: params.sensitive ?? false,
    },
  });
}
