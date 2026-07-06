import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkUserRestriction } from "@/lib/restrictions";

const MIN_IMAGES = 1;
const MAX_IMAGES = 5;
const LIST_DEFAULT_PAGE_SIZE = 20;
const LIST_MAX_PAGE_SIZE = 50;

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
  // /items/new 頁面會擋未完成 onboarding（無 profile）的使用者，但 API 本身也要重複這個檢查，
  // 避免有人跳過表單直接打 API 建立物品。
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  // M2 治理底線 §7「功能限制」：疊加在既有 requireUser() 之後的一段新檢查，被禁止上架或被
  // 全站封鎖的使用者不能建立新物品；不動上面 requireUser() 本身的呼叫方式。
  const restriction = await checkUserRestriction(user.id, "posting");
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
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
  if (!categoryId || !cityId) {
    return jsonError("UNPROCESSABLE", "請選擇分類與縣市");
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
  // 種類跟宣稱的 thumb/medium 對得上、且 thumb/medium 來自同一次上傳（objectKey 開頭的
  // uuid 相同）——避免有人拿別人上傳的 storage object 亂掛，或把不相干的縮圖/中圖亂湊對。
  const objectIds = images.flatMap((img) => [img.thumbObjectId, img.mediumObjectId]);
  if (new Set(objectIds).size !== objectIds.length) {
    return jsonError("UNPROCESSABLE", "圖片不能重複使用");
  }
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
    const thumbUploadId = thumb.objectKey.split("/")[1];
    const mediumUploadId = medium.objectKey.split("/")[1];
    if (!thumbUploadId || !mediumUploadId || thumbUploadId !== mediumUploadId) {
      return jsonError("UNPROCESSABLE", "圖片配對不正確");
    }
  }

  const now = new Date();
  try {
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

      // 狀態檢查跟這個 updateMany 之間有時間差：把 status: "pending" 跟 uploaderId 一併寫進
      // where 條件、事務內原子更新，兩個並行請求搶同一張圖片時只有一個能更新到全部筆數，
      // 另一個會在下面拋錯回滾，避免同一張圖片被綁到兩個不同的 Item 上。
      const updated = await tx.storageObject.updateMany({
        where: { id: { in: objectIds }, uploaderId: user.id, status: "pending" },
        data: { status: "linked", linkedAt: now },
      });
      if (updated.count !== objectIds.length) {
        throw new Error("IMAGE_ALREADY_USED");
      }

      return created;
    });

    return NextResponse.json({ id: item.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "IMAGE_ALREADY_USED") {
      return jsonError("UNPROCESSABLE", "圖片已被使用，請重新上傳");
    }
    throw err;
  }
}

// GET /api/items — 公開物品列表（縣市/分類/關鍵字篩選、cursor-based 分頁）。
// 這是 master-plan §6 第 2 項「列表」在 E2E 驗收前補上的實作：先前幾個 PR 只做了
// 上架／詳情頁，首頁目前仍是示範資料，還沒有真正查詢 published 物品的列表端點。
// 篩選＋排序刻意只用 items(status, city_id, category_id, created_at) 這條複合索引
// 涵蓋的欄位（見 master-plan §11.2），關鍵字用 title/description contains 屬於索引
// 之外的額外過濾，不影響 status+city+category+createdAt 這段走索引。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cityId = searchParams.get("cityId") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;
  const keyword = searchParams.get("q")?.trim() || undefined;
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, LIST_MAX_PAGE_SIZE)
      : LIST_DEFAULT_PAGE_SIZE;

  const where = {
    status: "published" as const,
    ...(cityId ? { cityId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" as const } },
            { description: { contains: keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const items = await db.item.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      city: { select: { name: true } },
      category: { select: { name: true } },
      images: {
        take: 1,
        orderBy: { sortOrder: "asc" },
        select: { thumbObject: { select: { objectKey: true } } },
      },
    },
  });

  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;

  return NextResponse.json({
    items: page.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
      city: item.city.name,
      category: item.category.name,
      thumbObjectKey: item.images[0]?.thumbObject?.objectKey ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
