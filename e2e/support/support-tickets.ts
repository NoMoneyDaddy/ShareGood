import { randomUUID } from "node:crypto";
import { db } from "./db";

/**
 * 直接在 storage_objects 造一筆「已上傳完成、待掛上 ticket」的假回報附件，略過真的打
 * MinIO（本機環境沒有跑 MinIO，S3_* 環境變數也沒設；跟 e2e/support/images.ts 對物品圖片
 * 的做法一致——測試主軸是回報 API 本身的權限/狀態機/併發保護，不是圖片管線，圖片管線
 * 本身在 M0 已經驗過）。objectKey 格式沿用 src/app/api/uploads/support-attachment/route.ts
 * 的慣例 `support-attachments/<uuid>/attachment.webp`。
 */
export async function createSupportAttachment(uploaderId: string) {
  const uploadId = randomUUID();
  const storageObject = await db.storageObject.create({
    data: {
      objectKey: `support-attachments/${uploadId}/attachment.webp`,
      kind: "support_attachment",
      status: "pending",
      mimeType: "image/webp",
      sizeBytes: 100_000,
      width: 1024,
      height: 768,
      uploaderId,
    },
  });
  return storageObject.id;
}

/** 賦予某個測試使用者一個角色（moderator/admin），供權限邊界測試用。 */
export async function grantRole(userId: string, role: "moderator" | "admin") {
  await db.userRole.create({ data: { userId, role } });
}
