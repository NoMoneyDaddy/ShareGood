import { db } from "./db";

/**
 * master-plan §7 第 3、4 項（強制下架／使用者限制）不在本次「申訴」任務範圍內（見
 * docs/superpowers/plans/2026-07-06-m2-m5-execution.md Wave 1 任務拆分）。強制下架
 * 建立端點（PATCH /api/items/[id]/force-remove）現在已經在 main 上了，但這裡仍直接在
 * DB 造 ItemRemoval／UserRestriction 兩張表的資料而不打那支 API，是為了讓申訴測試只
 * 專注驗證申訴 API 本身的行為、不依賴其他 wave 的實作細節（比照既有 e2e/support/images.ts
 * 略過真的 MinIO 上傳、直接造 storage_objects 假資料的作法）。
 */

/** 造一筆下架紀錄，並把物品狀態轉成 removed_by_moderator（比照真的強制下架會做的事）。 */
export async function createItemRemoval(itemId: string, moderatorId?: string) {
  await db.item.update({ where: { id: itemId }, data: { status: "removed_by_moderator" } });
  return db.itemRemoval.create({
    data: { itemId, moderatorId: moderatorId ?? null, reason: "測試用強制下架" },
  });
}

/** 造一筆使用者限制紀錄。 */
export async function createUserRestriction(userId: string, createdBy?: string) {
  return db.userRestriction.create({
    data: {
      userId,
      type: "no_posting",
      reason: "測試用功能限制",
      createdBy: createdBy ?? null,
    },
  });
}

/** 直接在 storage_objects 造一筆「已上傳完成、待掛上申訴」的申訴附件假資料，略過真的打
 * MinIO（比照 e2e/support/images.ts createImagePair 的既有作法）。objectKey 格式沿用
 * src/app/api/uploads/route.ts purpose=appeal 分支的慣例 `appeals/<uuid>/evidence.webp`。 */
export async function createAppealAttachment(uploaderId: string) {
  const { randomUUID } = await import("node:crypto");
  const uploadId = randomUUID();
  const storageObject = await db.storageObject.create({
    data: {
      objectKey: `appeals/${uploadId}/evidence.webp`,
      kind: "appeal_attachment",
      status: "pending",
      mimeType: "image/webp",
      sizeBytes: 100_000,
      width: 768,
      height: 768,
      uploaderId,
    },
  });
  return storageObject.id;
}

/** 授予 admin 角色（測試用；沒有走真的角色授予 API，因為那支 API 也不在本次範圍）。 */
export async function grantAdmin(userId: string) {
  await db.userRole.create({ data: { userId, role: "admin" } });
}
