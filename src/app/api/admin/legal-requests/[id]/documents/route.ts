import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  MAX_UPLOAD_BYTES,
  normalizeHeic,
  sniffImageMime,
  toWebpVariant,
  VARIANTS,
} from "@/lib/images";
import { putObject } from "@/lib/storage";

// POST /api/admin/legal-requests/[id]/documents — 上傳公文掃描檔（master-plan §7a 交付內容 6，
// StorageKind=law_enforcement_document）。沿用既有圖片管線（驗 magic bytes／HEIC 轉碼），跟
// 檢舉證據圖片一樣只產生單一 webp 變體。moderator/admin 皆可上傳。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const { id } = await params;
  const request = await db.lawEnforcementRequest.findUnique({ where: { id } });
  if (!request) return jsonError("NOT_FOUND", "找不到這筆調閱請求");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("BAD_REQUEST", "缺少 file 欄位");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("UNPROCESSABLE", "檔案超過大小上限");

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  let buffer: Buffer;
  try {
    buffer = await normalizeHeic(rawBuffer);
  } catch {
    return jsonError("UNPROCESSABLE", "檔案損毀或無法解析");
  }
  const mime = sniffImageMime(buffer);
  if (!mime) return jsonError("UNPROCESSABLE", "僅接受 jpg / png / webp 圖片掃描檔");

  const uploadId = randomUUID();
  const processed = await toWebpVariant(buffer, VARIANTS.medium.maxWidth, VARIANTS.medium.quality);
  const objectKey = `law-enforcement-documents/${uploadId}.webp`;
  await putObject(objectKey, processed.buffer, "image/webp");

  const document = await db.$transaction(async (tx) => {
    const storageObject = await tx.storageObject.create({
      data: {
        objectKey,
        kind: "law_enforcement_document",
        status: "linked",
        mimeType: "image/webp",
        sizeBytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        uploaderId: actor.id,
        linkedAt: new Date(),
      },
    });
    const doc = await tx.lawEnforcementRequestDocument.create({
      data: { requestId: id, storageObjectId: storageObject.id, uploadedBy: actor.id },
    });
    await tx.lawEnforcementRequestEvent.create({
      data: { requestId: id, action: "document_uploaded", actorId: actor.id },
    });
    return doc;
  });

  await writeAudit({
    actorId: actor.id,
    action: "law_enforcement_request.document_upload",
    targetType: "law_enforcement_request",
    targetId: id,
    sensitive: true,
  });

  return NextResponse.json({ id: document.id }, { status: 201 });
}
