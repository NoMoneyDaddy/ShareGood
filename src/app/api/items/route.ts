import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { COUPON_CATEGORY_SLUG, EXPIRING_FOOD_CATEGORY_SLUG } from "@/lib/categories";
import { encryptCouponCode } from "@/lib/coupon-crypto";
import { db } from "@/lib/db";
import { FEATURE_FLAGS, getFeatureFlag } from "@/lib/feature-flags";
import { checkIpThrottle, getClientIp, IpThrottleExceededError } from "@/lib/ip-throttle";
import { listPublishedItems } from "@/lib/items";
import { checkKeywordBlocklist } from "@/lib/keyword-blocklist";
import { checkNonTransferableCouponType } from "@/lib/non-transferable-coupon-types";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkUserRestriction } from "@/lib/restrictions";

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

// POST /api/items — 上架。M1 預設發布即公開；M2 起若 REQUIRE_REVIEW feature flag 開啟，
// 改為先進 pending_review 等人工審核（見下方 requireReview 判斷）。
// expiresAt 從表單傳來的是 "YYYY-MM-DD"（純日期，見 item-form.tsx 的 <input type="date">）；
// 明確用 +08:00（台北時區，master-plan §3.4 全站時區慣例）當天結束時刻解讀，避免用
// `new Date("YYYY-MM-DD")`（會解讀成 UTC 午夜）在伺服器時區不是 UTC+8 時，把日期往前推一天。
const INVALID_DATE = Symbol("INVALID_DATE");

function parseExpiresAtDate(value: unknown): Date | null | typeof INVALID_DATE {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return INVALID_DATE;
  const parsed = new Date(`${value}T23:59:59.999+08:00`);
  if (Number.isNaN(parsed.getTime())) return INVALID_DATE;
  return parsed;
}

const MAX_FIELD_LENGTHS = { faceValue: 50, merchantName: 50, notes: 300, code: 200 } as const;

type CouponInput = { faceValue: string; merchantName: string; notes: string | null; code: string };

function parseCouponInput(value: unknown): CouponInput | null {
  const c = value as Record<string, unknown> | null | undefined;
  const faceValue = typeof c?.faceValue === "string" ? c.faceValue.trim() : "";
  const merchantName = typeof c?.merchantName === "string" ? c.merchantName.trim() : "";
  const notesRaw = typeof c?.notes === "string" ? c.notes.trim() : "";
  const code = typeof c?.code === "string" ? c.code.trim() : "";
  if (!faceValue || faceValue.length > MAX_FIELD_LENGTHS.faceValue) return null;
  if (!merchantName || merchantName.length > MAX_FIELD_LENGTHS.merchantName) return null;
  if (notesRaw.length > MAX_FIELD_LENGTHS.notes) return null;
  if (!code || code.length > MAX_FIELD_LENGTHS.code) return null;
  return { faceValue, merchantName, notes: notesRaw || null, code };
}

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

  // M2 治理底線：每小時/每日上架次數上限，超過回 429（見 src/lib/rate-limit.ts）。
  try {
    await checkRateLimit(user.id, "item_create");
  } catch (e) {
    if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
    throw e;
  }

  const now = new Date();
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

  // M2 治理底線：關鍵字黑名單攔標題／描述，命中就擋（見 src/lib/keyword-blocklist.ts）。
  const hitKeyword =
    (await checkKeywordBlocklist(title)) ?? (await checkKeywordBlocklist(description));
  if (hitKeyword) {
    return jsonError("UNPROCESSABLE", "標題或描述包含不允許的內容，請修改後再送出");
  }

  const [category, city] = await Promise.all([
    db.category.findUnique({ where: { id: categoryId } }),
    db.city.findUnique({ where: { id: cityId } }),
  ]);
  if (!category?.isActive) return jsonError("UNPROCESSABLE", "無效的分類");
  if (!city) return jsonError("UNPROCESSABLE", "無效的縣市");

  // M3（master-plan §8）：優惠券／即期食品各自的到期日與額外欄位規則靠分類 slug 判斷，
  // 兩者共用 Item.expiresAt（schema 註解說明過，不重複存一份避免兩處日期不同步）。
  const isCoupon = category.slug === COUPON_CATEGORY_SLUG;
  const isExpiringFood = category.slug === EXPIRING_FOOD_CATEGORY_SLUG;

  const expiresAt = parseExpiresAtDate(body?.expiresAt);
  if (expiresAt === INVALID_DATE) {
    return jsonError("UNPROCESSABLE", "到期日格式不正確");
  }

  let couponInput: CouponInput | null = null;
  if (isCoupon) {
    couponInput = parseCouponInput(body?.coupon);
    if (!couponInput) {
      return jsonError("UNPROCESSABLE", "請完整填寫優惠券資訊（面額／適用店家／券碼）");
    }
    if (!expiresAt) {
      return jsonError("UNPROCESSABLE", "優惠券需填寫到期日");
    }

    // M9（master-plan §9a 交付內容 3）不可上架清單「攔截層一」：官方明文禁轉贈／官方
    // 閉環券種（LINE 即享券／LINE 禮物、行動隨時取、隨買跨店取）不能在本平台上架，
    // 正確做法是走官方 App 的轉贈功能。標題／店家／備註任一命中即擋（見
    // src/lib/non-transferable-coupon-types.ts）；自由文字的加價/折現詞則交給下面的
    // keyword_blocklist（攔截層二）負責，兩者分工不重複。
    const hitNonTransferable =
      checkNonTransferableCouponType(title) ??
      checkNonTransferableCouponType(couponInput.merchantName) ??
      checkNonTransferableCouponType(couponInput.notes ?? "");
    if (hitNonTransferable) {
      return jsonError(
        "UNPROCESSABLE",
        `「${hitNonTransferable}」為官方閉環／禁轉贈券種，請走官方 App 的轉贈功能，不能在本平台上架`,
      );
    }
  }

  if (isExpiringFood) {
    if (body?.expiringFoodConfirmed !== true) {
      return jsonError("UNPROCESSABLE", "即期食品需勾選確認：完整包裝、未開封、常溫保存、尚未過期");
    }
    if (!expiresAt) {
      return jsonError("UNPROCESSABLE", "即期食品需填寫到期日");
    }
  }

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return jsonError("UNPROCESSABLE", "到期日需晚於現在");
  }

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

  // M2 治理底線：REQUIRE_REVIEW flag 開啟時，新物品先進 pending_review（不直接公開），
  // 要人工審核通過才轉 published；後台審核佇列 UI 不在本次任務範圍內。
  const requireReview = await getFeatureFlag(FEATURE_FLAGS.REQUIRE_REVIEW);
  const initialStatus = requireReview ? ("pending_review" as const) : ("published" as const);

  try {
    const item = await db.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          ownerId: user.id,
          title,
          description,
          categoryId,
          cityId,
          status: initialStatus,
          publishedAt: initialStatus === "published" ? now : null,
          ...(expiresAt ? { expiresAt } : {}),
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

      // 即期食品確認欄位不落 schema 新欄位（限制不能動 prisma/schema.prisma），借用
      // ItemStatusLog.reason（既有的自由文字欄位）留下稽核紀錄，之後若真的需要查詢用的
      // 結構化欄位，M3 完整版可以再加。
      await tx.itemStatusLog.create({
        data: {
          itemId: created.id,
          fromStatus: null,
          toStatus: initialStatus,
          actorId: user.id,
          ...(isExpiringFood
            ? { reason: "即期食品確認：完整包裝／未開封／常溫保存／尚未過期" }
            : {}),
        },
      });

      // M3 優惠券：面額／店家／備註存明文（描述性文字，非機密），券碼明文加密後才存
      // CouponSecret；couponInput.code 只在這個 request 的記憶體裡短暫存在，離開這個
      // transaction 之後就不再被引用，也不會出現在任何回傳值或 log 裡。
      if (couponInput) {
        const couponDetail = await tx.couponDetail.create({
          data: {
            itemId: created.id,
            faceValue: couponInput.faceValue,
            merchantName: couponInput.merchantName,
            notes: couponInput.notes,
          },
        });
        const encrypted = encryptCouponCode(couponInput.code);
        await tx.couponSecret.create({
          data: {
            couponDetailId: couponDetail.id,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
          },
        });
      }

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
// 實際查詢邏輯集中在 src/lib/items.ts（listPublishedItems），/items 瀏覽頁與首頁「熱門好物」
// 區塊改為真實資料時，直接呼叫同一支函式（server component 內查 db，不自打這支 HTTP API），
// 這裡只負責解析 query string 並轉呼叫，避免兩處重複維護同一段查詢/排序邏輯。
export async function GET(req: NextRequest) {
  // P1：公開匿名端點的 IP 級節流（見 src/lib/ip-throttle.ts）。放在最前面，超限的請求
  // 不會進到後面的 DB 查詢，達到「擋掉高速抓取、保護 DB」的目的。取不到可識別 IP
  // （無反向代理標頭）時跳過，不落入共用 bucket 誤傷正常流量。
  const clientIp = getClientIp(req);
  if (clientIp) {
    try {
      checkIpThrottle(clientIp, "items_list");
    } catch (e) {
      if (e instanceof IpThrottleExceededError) return jsonError("RATE_LIMITED", e.message);
      throw e;
    }
  }

  const { searchParams } = new URL(req.url);
  const cityId = searchParams.get("cityId") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;
  const keyword = searchParams.get("q")?.trim() || undefined;
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const sort = searchParams.get("sort") === "expiring" ? "expiring" : "newest";

  const result = await listPublishedItems({
    cityId,
    categoryId,
    keyword,
    cursor,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    sort,
  });

  return NextResponse.json(result);
}
