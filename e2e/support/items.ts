import { api } from "./api";
import type { TestUser } from "./auth";
import { db } from "./db";
import { createImagePair } from "./images";

/** 隨便挑一組現成的縣市/分類（seed 資料已經有，見 prisma/seed.ts）。 */
export async function pickCityAndCategory() {
  const [city, category] = await Promise.all([
    db.city.findFirstOrThrow({ orderBy: { sortOrder: "asc" } }),
    db.category.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { cityId: city.id, categoryId: category.id };
}

/** 透過真的 POST /api/items 建立一個 published 物品（跟正式流程走同一段驗證邏輯）。 */
export async function createPublishedItem(
  owner: TestUser,
  overrides: { title?: string; cityId?: string; categoryId?: string } = {},
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
    },
  });
  if (res.status !== 201) {
    throw new Error(`建立測試物品失敗：${res.status} ${JSON.stringify(res.json)}`);
  }
  return (res.json as { id: string }).id;
}
