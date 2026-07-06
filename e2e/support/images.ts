import { randomUUID } from "node:crypto";
import { db } from "./db";

/**
 * 直接在 storage_objects 造一組「已上傳完成、待掛上物品」的 thumb/medium 假資料，
 * 略過真的打 MinIO（測試主軸是主迴路狀態機與權限，不是圖片管線本身，M0 已經對圖片
 * 管線本身驗過）。objectKey 格式沿用 src/app/api/uploads/route.ts 的慣例
 * `images/<uuid>/<variant>.webp`，thumb/medium 共用同一個 uuid，符合
 * POST /api/items 對「兩張圖來自同一次上傳」的檢查（見該檔案 thumbUploadId/mediumUploadId 比對）。
 */
export async function createImagePair(uploaderId: string) {
  const uploadId = randomUUID();
  const [thumb, medium] = await Promise.all([
    db.storageObject.create({
      data: {
        objectKey: `images/${uploadId}/thumb.webp`,
        kind: "item_image_thumb",
        status: "pending",
        mimeType: "image/webp",
        sizeBytes: 8_000,
        width: 320,
        height: 320,
        uploaderId,
      },
    }),
    db.storageObject.create({
      data: {
        objectKey: `images/${uploadId}/medium.webp`,
        kind: "item_image_medium",
        status: "pending",
        mimeType: "image/webp",
        sizeBytes: 300_000,
        width: 768,
        height: 768,
        uploaderId,
      },
    }),
  ]);
  return { thumbObjectId: thumb.id, mediumObjectId: medium.id };
}
