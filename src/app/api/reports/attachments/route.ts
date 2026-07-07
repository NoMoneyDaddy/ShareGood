import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  MAX_UPLOAD_BYTES,
  normalizeHeic,
  sniffImageMime,
  toWebpVariant,
  VARIANTS,
} from "@/lib/images";
import { putObject } from "@/lib/storage";

// POST /api/reports/attachments — 檢舉證據圖片上傳（multipart form，欄位 file）。
// 沿用 §3.3 圖片管線（驗 magic bytes／HEIC 轉碼／去 EXIF／壓縮），但跟 POST /api/uploads
// 不同：ReportEvidence 一筆只對應一個 StorageObject（schema 沒有 thumb/medium 配對欄位，
// 證據圖片不需要列表縮圖），所以這裡只產生一個 webp 變體（沿用 VARIANTS.medium 的尺寸／
// 品質設定），kind 固定 report_attachment。回傳的 id 即為 POST /api/reports 的
// evidenceObjectIds 陣列要帶的值。
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
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("UNPROCESSABLE", "檔案超過 5 MB 上限");

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  let buffer: Buffer;
  try {
    buffer = await normalizeHeic(rawBuffer);
  } catch {
    return jsonError("UNPROCESSABLE", "HEIC 檔案損毀或無法解析，請重新拍攝或改用 jpg/png");
  }
  const mime = sniffImageMime(buffer);
  if (!mime) return jsonError("UNPROCESSABLE", "僅接受 jpg / png / webp 圖片");

  const id = randomUUID();
  const processed = await toWebpVariant(buffer, VARIANTS.medium.maxWidth, VARIANTS.medium.quality);
  const objectKey = `report-attachments/${id}.webp`;
  await putObject(objectKey, processed.buffer, "image/webp");

  const storageObject = await db.storageObject.create({
    data: {
      objectKey,
      kind: "report_attachment",
      mimeType: "image/webp",
      sizeBytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height,
      uploaderId: user.id,
    },
  });

  return NextResponse.json(
    {
      id: storageObject.id,
      objectKey,
      width: processed.width,
      height: processed.height,
    },
    { status: 201 },
  );
}
