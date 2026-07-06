import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES, normalizeHeic, sniffImageMime, toWebpVariant } from "@/lib/images";
import { putObject } from "@/lib/storage";

// 回報附件走同一條圖片管線（master-plan §3.3：驗 magic bytes → 去 EXIF → 壓縮），
// 但只需要單一尺寸（沒有 thumb/medium 兩張的需求——SupportTicketAttachment 一列只
// 掛一個 storageObjectId，見 prisma/schema.prisma），跟 POST /api/uploads
// （物品圖片，固定產出 thumb+medium 兩張）分開成獨立 route，避免混用同一組
// VARIANTS 設定、也不用動既有 M1 上傳端點。
const ATTACHMENT_VARIANT = { maxWidth: 1024, quality: 78 };

// POST /api/uploads/support-attachment — multipart form（欄位 file）。
// 回傳單一 storage object（kind: support_attachment, status: pending），
// 建立回報時用 attachmentObjectIds 帶上（見 POST /api/support-tickets）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("BAD_REQUEST", "缺少 file 欄位");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("UNPROCESSABLE", "檔案超過 5MB 上限");

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  let buffer: Buffer;
  try {
    buffer = await normalizeHeic(rawBuffer); // iPhone 相機預設 HEIC，先轉 JPEG 再走既有管線
  } catch {
    return jsonError("UNPROCESSABLE", "HEIC 檔案損毀或無法解析，請重新拍攝或改用 jpg/png");
  }
  const mime = sniffImageMime(buffer);
  if (!mime) return jsonError("UNPROCESSABLE", "僅接受 jpg / png / webp 圖片");

  const id = randomUUID();
  const processed = await toWebpVariant(
    buffer,
    ATTACHMENT_VARIANT.maxWidth,
    ATTACHMENT_VARIANT.quality,
  );
  const objectKey = `support-attachments/${id}/attachment.webp`;
  await putObject(objectKey, processed.buffer, "image/webp");
  const storageObject = await db.storageObject.create({
    data: {
      objectKey,
      kind: "support_attachment",
      mimeType: "image/webp",
      sizeBytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height,
      uploaderId: user.id,
    },
  });

  return NextResponse.json(
    {
      storageObjectId: storageObject.id,
      objectKey,
      width: processed.width,
      height: processed.height,
    },
    { status: 201 },
  );
}
