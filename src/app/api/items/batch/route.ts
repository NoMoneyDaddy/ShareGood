import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import {
  COUPON_CATEGORY_SLUG,
  EXPIRING_FOOD_CATEGORY_SLUG,
  POINT_CATEGORY_SLUG,
  TICKET_CATEGORY_SLUG,
} from "@/lib/categories";
import { db } from "@/lib/db";
import { FEATURE_FLAGS, getFeatureFlag } from "@/lib/feature-flags";
import { type ImageInput, validateBasicItemFields } from "@/lib/item-validation";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkUserRestriction } from "@/lib/restrictions";

// POST /api/items/batch — M12 交付內容 7（供給側批量上架，docs/plan/m12-product-growth.md）：
// `/items/new` 的「一次建立多筆相似物品」捷徑，服務冷啟動期團隊/親友大量上架
// （master-plan「冷啟動與宣傳建議」第 1 項）。
//
// scope guard（明確排除）：僅適用一般物品分類，不支援優惠券／即期食品／票券／點數四種需要
// 複雜子欄位（券碼加密、到期日、法定警示確認勾選等）的分類——這些每筆的專屬欄位天生就不容易
// 「相似批量」，硬做只會讓表單更複雜、驗證邏輯更難維護（見規格 scope guard 一節）。
//
// 驗證階段全部先跑完、任何一筆不合格就整批 422 拒絕，不做部分成功；通過驗證後整批包在同一個
// $transaction 裡（claim images ＋ item.create ＋ itemStatusLog.create），全部成功才 commit。
const MAX_BATCH_ITEMS = 10;
const MIN_BATCH_ITEMS = 1;

const SPECIAL_CATEGORY_SLUGS = new Set([
  COUPON_CATEGORY_SLUG,
  EXPIRING_FOOD_CATEGORY_SLUG,
  TICKET_CATEGORY_SLUG,
  POINT_CATEGORY_SLUG,
]);

type ValidatedBatchItem = { title: string; description: string; images: ImageInput[] };

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }
  // 與既有 POST /api/items 完全相同的前置檢查，直接沿用（規格明訂）。
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  const restriction = await checkUserRestriction(user.id, "posting");
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  // 批量端點套用較寬鬆的獨立門檻（item_create_batch），不是既有 item_create 的門檻——
  // counter 查詢完全相同，只是門檻數字不同（見 src/lib/rate-limit.ts 註解）。
  try {
    await checkRateLimit(user.id, "item_create_batch");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  const now = new Date();
  const body = await req.json().catch(() => null);
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
  const cityId = typeof body?.cityId === "string" ? body.cityId : "";
  const itemsInput = Array.isArray(body?.items) ? body.items : null;

  if (!categoryId || !cityId) {
    return jsonError("UNPROCESSABLE", "請選擇分類與縣市");
  }
  if (!itemsInput || itemsInput.length < MIN_BATCH_ITEMS || itemsInput.length > MAX_BATCH_ITEMS) {
    return jsonError("UNPROCESSABLE", `批量上架每次需為 ${MIN_BATCH_ITEMS}–${MAX_BATCH_ITEMS} 筆`);
  }

  const [category, city] = await Promise.all([
    db.category.findUnique({ where: { id: categoryId } }),
    db.city.findUnique({ where: { id: cityId } }),
  ]);
  if (!category?.isActive) return jsonError("UNPROCESSABLE", "無效的分類");
  if (!city) return jsonError("UNPROCESSABLE", "無效的縣市");

  if (SPECIAL_CATEGORY_SLUGS.has(category.slug)) {
    return jsonError("UNPROCESSABLE", "此分類請個別上架，批量上架僅適用一般物品分類");
  }

  // 驗證階段全部先跑完、任何一筆不合格就整批拒絕（details 帶每一筆的 index）。
  const validated: ValidatedBatchItem[] = [];
  const details: Array<{ index: number; message: string }> = [];
  for (let index = 0; index < itemsInput.length; index++) {
    const result = await validateBasicItemFields(itemsInput[index]);
    if (!result.ok) {
      details.push({ index, message: result.message });
      continue;
    }
    validated.push(result.value);
  }
  if (details.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "UNPROCESSABLE",
          message: "批量上架有欄位未通過驗證，請修正後整批重新送出",
          details,
        },
      },
      { status: 422 },
    );
  }

  // 圖片 ID 不能跨筆重複使用（同一批次內任兩筆都不能共用同一張圖）；單筆內部的重複已由
  // validateBasicItemFields→parseImages 交給下面每筆各自的擁有權檢查一併擋下（同一 ID
  // 出現兩次會在下面的「所有圖片都必須屬於自己、且狀態還是 pending」檢查時，因為第二次
  // claim 會撞到第一次已經用掉的狀態而失敗；這裡額外做一次全批次層級的 in-memory 檢查，
  // 提供更精確的錯誤訊息，不必等到 DB 層才發現)。
  const allObjectIds = validated.flatMap((item) => [
    ...item.images.map((img) => img.thumbObjectId),
    ...item.images.map((img) => img.mediumObjectId),
  ]);
  if (new Set(allObjectIds).size !== allObjectIds.length) {
    return jsonError("UNPROCESSABLE", "同一批次內的圖片不能重複使用");
  }

  // 逐一驗證圖片擁有權／狀態／種類／配對，邏輯與既有 POST /api/items 完全相同（沿用同一套
  // 檢查規則，只是要逐筆收集索引，不是遇到第一筆錯就直接回傳）。
  const storageObjects = await db.storageObject.findMany({ where: { id: { in: allObjectIds } } });
  const byId = new Map(storageObjects.map((o) => [o.id, o]));

  for (let index = 0; index < validated.length; index++) {
    const item = validated[index];
    for (const img of item.images) {
      const thumb = byId.get(img.thumbObjectId);
      const medium = byId.get(img.mediumObjectId);
      if (!thumb || !medium) {
        details.push({ index, message: "圖片不存在，請重新上傳" });
        break;
      }
      if (thumb.uploaderId !== user.id || medium.uploaderId !== user.id) {
        details.push({ index, message: "不能使用他人上傳的圖片" });
        break;
      }
      if (thumb.status !== "pending" || medium.status !== "pending") {
        details.push({ index, message: "圖片已被使用，請重新上傳" });
        break;
      }
      if (thumb.kind !== "item_image_thumb" || medium.kind !== "item_image_medium") {
        details.push({ index, message: "圖片格式不正確" });
        break;
      }
      const thumbUploadId = thumb.objectKey.split("/")[1];
      const mediumUploadId = medium.objectKey.split("/")[1];
      if (!thumbUploadId || !mediumUploadId || thumbUploadId !== mediumUploadId) {
        details.push({ index, message: "圖片配對不正確" });
        break;
      }
    }
  }
  if (details.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "UNPROCESSABLE",
          message: "批量上架有欄位未通過驗證，請修正後整批重新送出",
          details,
        },
      },
      { status: 422 },
    );
  }

  // REQUIRE_REVIEW feature flag 決定初始狀態，同既有單筆邏輯。
  const requireReview = await getFeatureFlag(FEATURE_FLAGS.REQUIRE_REVIEW);
  const initialStatus = requireReview ? ("pending_review" as const) : ("published" as const);

  try {
    const createdItems = await db.$transaction(async (tx) => {
      const results: { id: string; title: string }[] = [];
      for (const item of validated) {
        const created = await tx.item.create({
          data: {
            ownerId: user.id,
            title: item.title,
            description: item.description,
            categoryId,
            cityId,
            status: initialStatus,
            publishedAt: initialStatus === "published" ? now : null,
          },
        });

        await tx.itemImage.createMany({
          data: item.images.map((img, idx) => ({
            itemId: created.id,
            thumbObjectId: img.thumbObjectId,
            mediumObjectId: img.mediumObjectId,
            sortOrder: idx,
          })),
        });

        await tx.itemStatusLog.create({
          data: {
            itemId: created.id,
            fromStatus: null,
            toStatus: initialStatus,
            actorId: user.id,
            reason: "批量上架",
          },
        });

        results.push({ id: created.id, title: created.title });
      }

      // 全部物品都建立完成後，一次性原子搶用這一批所有圖片（沿用既有 POST /api/items 的
      // uploaderId+status=pending→linked 原子 updateMany 搶用防呆）。批量的原子性圖片搶用
      // 失敗機率應該極低（使用者自己剛上傳的圖片，不會被別人搶），回滾是防呆而非常態路徑。
      const updated = await tx.storageObject.updateMany({
        where: { id: { in: allObjectIds }, uploaderId: user.id, status: "pending" },
        data: { status: "linked", linkedAt: now },
      });
      if (updated.count !== allObjectIds.length) {
        throw new Error("IMAGE_ALREADY_USED");
      }

      return results;
    });

    return NextResponse.json({ items: createdItems }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "IMAGE_ALREADY_USED") {
      return jsonError("UNPROCESSABLE", "圖片已被使用，請重新上傳");
    }
    throw err;
  }
}
