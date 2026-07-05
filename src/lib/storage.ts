import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

const BUCKET = process.env.S3_BUCKET!;

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
