import { checkKeywordBlocklist } from "@/lib/keyword-blocklist";

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：把 POST /api/items 裡
// title／description／images（格式）／keyword_blocklist 這段驗證邏輯抽成共用函式，讓批量
// 端點（POST /api/items/batch）與既有單筆端點共用，不要複製貼上第二份。
//
// 刻意只抽「格式驗證＋關鍵字黑名單」這一段（不含 categoryId/cityId 有效性查詢、圖片
// 擁有權/狀態的 DB 驗證、優惠券/票券/點數等分類專屬欄位）：那些邏輯在單筆與批量端點的
// 呼叫時機與錯誤處理方式不完全一樣（批量要收集所有 index 的錯誤才能一次回傳 details），
// 硬抽成同一個函式反而會讓兩邊都要遷就對方的介面。這裡抽出的部分是兩邊完全一致、
// 沒有時機差異的「純格式檢查」。

export const MIN_IMAGES = 1;
export const MAX_IMAGES = 5;

export type ImageInput = { thumbObjectId: string; mediumObjectId: string };

export function parseImages(value: unknown): ImageInput[] | null {
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

export type BasicItemFields = { title: string; description: string; images: ImageInput[] };

export type BasicItemFieldsResult =
  | { ok: true; value: BasicItemFields }
  | { ok: false; message: string };

/**
 * 驗證上架表單共通的基本欄位：標題（2–60 字）、描述（1–1000 字）、圖片（1–5 張，格式正確）、
 * 標題／描述過關鍵字黑名單。回傳 trim 過的字串與解析好的圖片陣列，或第一個驗證失敗的錯誤訊息
 * （文字與既有 POST /api/items 逐字一致，避免抽出來後改變既有錯誤文案）。
 */
export async function validateBasicItemFields(body: unknown): Promise<BasicItemFieldsResult> {
  const b = body as Record<string, unknown> | null | undefined;
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  const description = typeof b?.description === "string" ? b.description.trim() : "";
  const images = parseImages(b?.images);

  if (title.length < 2 || title.length > 60) {
    return { ok: false, message: "標題需為 2–60 個字" };
  }
  if (description.length < 1 || description.length > 1000) {
    return { ok: false, message: "分享的話需為 1–1000 個字" };
  }
  if (!images) {
    return { ok: false, message: `請上傳 ${MIN_IMAGES}–${MAX_IMAGES} 張圖片` };
  }

  const hitKeyword =
    (await checkKeywordBlocklist(title)) ?? (await checkKeywordBlocklist(description));
  if (hitKeyword) {
    return { ok: false, message: "標題或描述包含不允許的內容，請修改後再送出" };
  }

  return { ok: true, value: { title, description, images } };
}
