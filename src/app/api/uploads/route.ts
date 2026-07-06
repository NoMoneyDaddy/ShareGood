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
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkFullBlock } from "@/lib/restrictions";
import { putObject } from "@/lib/storage";

// POST /api/uploads — multipart form（欄位 file）。
// 預設（無 purpose 或 purpose=item）：回傳 thumb/medium 兩個 storage object，給物品圖片用
// （status: pending，掛上實體時轉 linked）。
// purpose=appeal：申訴附件（master-plan §7 第 6 項／§3.3 圖片管線）只需要單一尺寸給後台
// 複審時檢視，不像物品圖片需要縮圖＋中圖兩種尺寸給列表/詳情頁分別使用，所以只產生一張
// medium 尺寸的 webp、kind 為 appeal_attachment，回傳單一 storageObjectId（不是 variants 物件）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  // M2 治理底線：每小時/每日上傳次數上限，超過回 429（見 src/lib/rate-limit.ts）。
  try {
    await checkRateLimit(user.id, "upload_create");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  const purpose = new URL(req.url).searchParams.get("purpose") === "appeal" ? "appeal" : "item";

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

  if (purpose === "appeal") {
    const processed = await toWebpVariant(
      buffer,
      VARIANTS.medium.maxWidth,
      VARIANTS.medium.quality,
    );
    const objectKey = `appeals/${id}/evidence.webp`;
    await putObject(objectKey, processed.buffer, "image/webp");
    const storageObject = await db.storageObject.create({
      data: {
        objectKey,
        kind: "appeal_attachment",
        mimeType: "image/webp",
        sizeBytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        uploaderId: user.id,
      },
    });
    return NextResponse.json(
      {
        id,
        storageObjectId: storageObject.id,
        objectKey,
        width: processed.width,
        height: processed.height,
      },
      { status: 201 },
    );
  }

  const results: Record<
    string,
    { storageObjectId: string; objectKey: string; width: number; height: number }
  > = {};

  for (const [name, opt] of Object.entries(VARIANTS)) {
    const processed = await toWebpVariant(buffer, opt.maxWidth, opt.quality);
    const objectKey = `images/${id}/${name}.webp`;
    await putObject(objectKey, processed.buffer, "image/webp");
    const storageObject = await db.storageObject.create({
      data: {
        objectKey,
        kind: name === "thumb" ? "item_image_thumb" : "item_image_medium",
        mimeType: "image/webp",
        sizeBytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        uploaderId: user.id,
      },
    });
    results[name] = {
      storageObjectId: storageObject.id,
      objectKey,
      width: processed.width,
      height: processed.height,
    };
  }

  return NextResponse.json({ id, variants: results }, { status: 201 });
}
