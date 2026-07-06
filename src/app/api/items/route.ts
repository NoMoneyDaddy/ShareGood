import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";

const MIN_IMAGES = 1;
const MAX_IMAGES = 5;

type ImageInput = { thumbObjectId: string; mediumObjectId: string };

function parseImages(value: unknown): ImageInput[] | null {
  if (!Array.isArray(value) || value.length < MIN_IMAGES || value.length > MAX_IMAGES) return null;
  const parsed: ImageInput[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).thumbObjectId !== "string" ||
      typeof (entry as Record<string, unknown>).mediumObjectId !== "string"
    ) {
      return null;
    }
    const { thumbObjectId, mediumObjectId } = entry as Record<string, string>;
    parsed.push({ thumbObjectId, mediumObjectId });
  }
  return parsed;
}

// POST /api/items — 上架（M1：發布即公開，不走 pending_review）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  const cityId = typeof body?.cityId === "string" ? body.cityId : "";
  const images = parseImages(body?.images);

  if (title.length < 2 || title.length > 60) {
    return jsonError("UNPROCESSABLE", "標題需為 2–60 個字");
  }
  if (description.length < 1 || description.length > 1000) {
    return jsonError("UNPROCESSABLE", "分享的話需為 1–1000 個字");
  }
  if (!images) {
    return jsonError("UNPROCESSABLE", `請上傳 ${MIN_IMAGES}–${MAX_IMAGES} 張圖片`);
  }

  const [category, city] = await Promise.all([
    db.category.findUnique({ where: { id: categoryId } }),
    db.city.findUnique({ where: { id: cityId } }),
  ]);
  if (!category?.isActive) return jsonError("UNPROCESSABLE", "無效的分類");
  if (!city) return jsonError("UNPROCESSABLE", "無效的縣市");

  // 逐一驗證圖片：必須是這個使用者自己上傳、狀態還是 pending（沒被其他物品用掉）、
  // 種類跟宣稱的 thumb/medium 對得上——避免有人拿別人上傳的 storage object 亂掛。
  const objectIds = images.flatMap((img) => [img.thumbObjectId, img.mediumObjectId]);
  const storageObjects = await db.storageObject.findMany({ where: { id: { in: objectIds } } });
  const byId = new Map(storageObjects.map((o) => [o.id, o]));

  for (const img of images) {
    const thumb = byId.get(img.thumbObjectId);
    const medium = byId.get(img.mediumObjectId);
    if (!thumb || !medium) return jsonError("UNPROCESSABLE", "圖片不存在，請重新上傳");
    if (thumb.uploaderId !== user.id || medium.uploaderId !== user.id) {
      return jsonError("FORBIDDEN", "不能使用他人上傳的圖片");
    }
    if (thumb.status !== "pending" || medium.status !== "pending") {
      return jsonError("UNPROCESSABLE", "圖片已被使用，請重新上傳");
    }
    if (thumb.kind !== "item_image_thumb" || medium.kind !== "item_image_medium") {
      return jsonError("UNPROCESSABLE", "圖片格式不正確");
    }
  }

  const now = new Date();
  const item = await db.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        ownerId: user.id,
        title,
        description,
        categoryId,
        cityId,
        status: "published",
        publishedAt: now,
      },
    });

    await tx.itemImage.createMany({
      data: images.map((img, index) => ({
        itemId: created.id,
        thumbObjectId: img.thumbObjectId,
        mediumObjectId: img.mediumObjectId,
        sortOrder: index,
      })),
    });

    await tx.itemStatusLog.create({
      data: { itemId: created.id, fromStatus: null, toStatus: "published", actorId: user.id },
    });

    await tx.storageObject.updateMany({
      where: { id: { in: objectIds } },
      data: { status: "linked", linkedAt: now },
    });

    return created;
  });

  return NextResponse.json({ id: item.id }, { status: 201 });
}
