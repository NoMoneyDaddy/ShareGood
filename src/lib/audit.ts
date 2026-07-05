import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/** 管理操作與敏感調閱一律經過這裡寫 audit_logs（CLAUDE.md 硬規則 6）。 */
export async function writeAudit(params: {
  actorId: string | null;
  action: string; // 例：user.role.grant / item.force_remove
  targetType: string;
  targetId?: string;
  detail?: Prisma.InputJsonValue;
  sensitive?: boolean;
}) {
  await db.auditLog.create({
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
