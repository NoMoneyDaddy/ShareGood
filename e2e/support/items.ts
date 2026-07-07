import {
  COUPON_CATEGORY_SLUG,
  EXPIRING_FOOD_CATEGORY_SLUG,
  POINT_CATEGORY_SLUG,
  TICKET_CATEGORY_SLUG,
} from "@/lib/categories";
import { api } from "./api";
import type { TestUser } from "./auth";
import { db } from "./db";
import { createImagePair } from "./images";

/**
 * 隨便挑一組現成的縣市/分類（seed 資料已經有，見 prisma/seed.ts）。
 *
 * 刻意排除優惠券／即期食品／票券／點數這幾個分類（M3 master-plan §8、M9 §9a）：這些分類在
 * `POST /api/items` 有額外必填欄位（券碼／到期日／即期食品確認勾選／券種原平台／點數平台數量，
 * 見 src/app/api/items/route.ts），大多數不特別關心分類的測試（M1/M2 的權限、SEO、
 * 強制下架等）用預設分類只是想要「隨便一個合法分類」，不應該意外撞進這些額外規則。
 * 真的需要測這些規則的測試請改用 createPublishedItem 的
 * categoryId／coupon／expiringFoodConfirmed／ticket／point 參數明確指定。
 */
export async function pickCityAndCategory() {
  const [city, category] = await Promise.all([
    db.city.findFirstOrThrow({ orderBy: { sortOrder: "asc" } }),
    db.category.findFirstOrThrow({
      where: {
        isActive: true,
        slug: {
          notIn: [
            COUPON_CATEGORY_SLUG,
            EXPIRING_FOOD_CATEGORY_SLUG,
            TICKET_CATEGORY_SLUG,
            POINT_CATEGORY_SLUG,
          ],
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  return { cityId: city.id, categoryId: category.id };
}

/** 透過真的 POST /api/items 建立一個 published 物品（跟正式流程走同一段驗證邏輯）。 */
export async function createPublishedItem(
  owner: TestUser,
  overrides: {
    title?: string;
    cityId?: string;
    categoryId?: string;
    // M3（master-plan §8）：優惠券／即期食品／到期日測試用，見
    // e2e/integration/coupon-expiration.test.ts。
    expiresAt?: string;
    coupon?: { faceValue: string; merchantName: string; notes?: string; code: string };
    expiringFoodConfirmed?: boolean;
    // M9（master-plan §9a 交付內容 4/5）：票券／點數測試用。
    ticket?: { ticketType: string; originPlatform: string; eventName?: string };
    point?: { pointPlatform: string; pointAmount: number };
  } = {},
): Promise<string> {
  const { cityId, categoryId } = await pickCityAndCategory();
  const images = await createImagePair(owner.id);
  const res = await api("/api/items", {
    method: "POST",
    user: owner,
    body: {
      title: overrides.title ?? "E2E 測試物品",
      description: "整合測試用的假物品描述內容",
      categoryId: overrides.categoryId ?? categoryId,
      cityId: overrides.cityId ?? cityId,
      images: [images],
      ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
      ...(overrides.coupon ? { coupon: overrides.coupon } : {}),
      ...(overrides.expiringFoodConfirmed !== undefined
        ? { expiringFoodConfirmed: overrides.expiringFoodConfirmed }
        : {}),
      ...(overrides.ticket ? { ticket: overrides.ticket } : {}),
      ...(overrides.point ? { point: overrides.point } : {}),
    },
  });
  if (res.status !== 201) {
    throw new Error(`建立測試物品失敗：${res.status} ${JSON.stringify(res.json)}`);
  }
  return (res.json as { id: string }).id;
}

/**
 * 跟 createPublishedItem 一樣打真的 POST /api/items，但不假設一定成功——用來測試各種
 * 422 驗證邊界（票券不可上架清單、點數手機號攔截等），回傳原始 API 回應讓呼叫端自行斷言。
 */
export async function attemptCreateItem(
  owner: TestUser,
  overrides: {
    title?: string;
    description?: string;
    cityId?: string;
    categoryId?: string;
    expiresAt?: string;
    ticket?: { ticketType: string; originPlatform: string; eventName?: string };
    point?: { pointPlatform: string; pointAmount: number };
  } = {},
) {
  const { cityId, categoryId } = await pickCityAndCategory();
  const images = await createImagePair(owner.id);
  return api("/api/items", {
    method: "POST",
    user: owner,
    body: {
      title: overrides.title ?? "E2E 測試物品",
      description: overrides.description ?? "整合測試用的假物品描述內容",
      categoryId: overrides.categoryId ?? categoryId,
      cityId: overrides.cityId ?? cityId,
      images: [images],
      ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
      ...(overrides.ticket ? { ticket: overrides.ticket } : {}),
      ...(overrides.point ? { point: overrides.point } : {}),
    },
  });
}
