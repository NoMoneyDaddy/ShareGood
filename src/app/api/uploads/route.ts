import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES, sniffImageMime, toWebpVariant, VARIANTS } from "@/lib/images";
import { putObject } from "@/lib/storage";

// POST /api/uploads — multipart form（欄位 file）。
// 回傳 thumb/medium 兩個 storage object（status: pending，掛上實體時轉 linked）。
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(buffer);
  if (!mime) return jsonError("UNPROCESSABLE", "僅接受 jpg / png / webp 圖片");

  const id = randomUUID();
  const results: Record<string, { objectKey: string; width: number; height: number }> = {};

  for (const [name, opt] of Object.entries(VARIANTS)) {
    const processed = await toWebpVariant(buffer, opt.maxWidth, opt.quality);
    const objectKey = `images/${id}/${name}.webp`;
    await putObject(objectKey, processed.buffer, "image/webp");
    await db.storageObject.create({
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
    results[name] = { objectKey, width: processed.width, height: processed.height };
  }

  return NextResponse.json({ id, variants: results }, { status: 201 });
}
