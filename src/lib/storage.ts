import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// MinIO（S3 相容）連線；圖片一律走這裡，DB 只存 object key（master-plan §3.3）
// 下方 process.env.*! 是必填變數（見 .env.example），缺少應在啟動時直接失敗，
// 而非加運行時檢查掩蓋設定錯誤——biome.json 已對 noNonNullAssertion 關閉此規則。
export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1", // MinIO 不驗 region，SDK 必填
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

// M8 storage 用量儀表板／健康檢查（`src/lib/storage-usage.ts`、`src/lib/health.ts`）需要
// 直接呼叫 ListObjectsV2／HeadBucket，因此 export 出來給它們重用，避免各自重複讀
// `process.env.S3_BUCKET!`。
export const BUCKET = process.env.S3_BUCKET!;

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** 對外讀取 URL（正式環境指向 MinIO 公開端點或反向代理）。 */
export function publicUrl(key: string) {
  return `${process.env.S3_PUBLIC_URL}/${key}`;
}

/**
 * 簽名下載連結（master-plan §7a 交付內容 2）：給資料匯出包、警方調閱匯出包這類私密內容用，
 * 不可比照 `publicUrl()` 那種靠「猜不到路徑」當防護的永久網址。短效期、每次呼叫端點都重新簽一個，
 * 不快取/不回傳固定網址。過期後同一個網址直接 GET 會被 S3/MinIO 回 403（AccessDenied）。
 */
export async function getPresignedDownloadUrl(key: string, expiresInSeconds: number) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
