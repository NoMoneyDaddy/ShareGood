// M6 訂閱通知（master-plan.md §6a）：關鍵字正規化、比對邏輯、上限常數集中放這裡，讓
// 建立/編輯訂閱的 API 與排程比對 job 共用同一套規則，不會兩邊各寫一份走鐘。

export const MAX_SUBSCRIPTIONS_PER_USER = 20;
export const MAX_KEYWORDS_PER_SUBSCRIPTION = 5;
const MAX_KEYWORD_LENGTH = 30;
const MAX_LABEL_LENGTH = 50;

/**
 * 關鍵字正規化（master-plan §6a 交付內容 5）：NFKC（全形→半形、相容字元正規化）+ trim +
 * toLowerCase，讓「Ｉphone」「iPhone」正規化後一致。`String.prototype.normalize("NFKC")`
 * 是標準 ECMAScript API（見 MDN String.prototype.normalize()）。
 */
export function normalizeKeyword(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** 物品比對用文字：title+description 正規化後的字串，跟關鍵字用同一套正規化規則。 */
export function buildNormalizedItemText(title: string, description: string): string {
  return normalizeKeyword(`${title} ${description}`);
}

type SubscriptionForMatch = {
  keywords: { normalizedKeyword: string }[];
  categories: { categoryId: string }[];
  cities: { cityId: string }[];
};

type ItemForMatch = { categoryId: string; cityId: string };

/**
 * 比對規則（master-plan §6a 交付內容 5）：三個維度內部 OR、跨維度 AND；某維度沒設定就視為
 * 該維度不篩選（永遠 true）。關鍵字採子字串比對（不是整詞比對），理由見規格說明：中文沒有
 * 空白分詞，整詞比對幾乎比對不到任何自然語句。
 */
export function isMatch(
  subscription: SubscriptionForMatch,
  item: ItemForMatch,
  normalizedItemText: string,
): boolean {
  const keywordOk =
    subscription.keywords.length === 0 ||
    subscription.keywords.some((k) => normalizedItemText.includes(k.normalizedKeyword));
  const categoryOk =
    subscription.categories.length === 0 ||
    subscription.categories.some((c) => c.categoryId === item.categoryId);
  const cityOk =
    subscription.cities.length === 0 || subscription.cities.some((c) => c.cityId === item.cityId);
  return keywordOk && categoryOk && cityOk;
}

export type ParsedSubscriptionInput = {
  label: string | null;
  immediateEnabled: boolean;
  dailyDigestEnabled: boolean;
  keywords: { keyword: string; normalizedKeyword: string }[];
  categoryIds: string[];
  cityIds: string[];
};

export type ParseSubscriptionInputResult =
  | { ok: true; value: ParsedSubscriptionInput }
  | { ok: false; message: string };

/**
 * 解析並驗證建立/編輯訂閱的 request body（master-plan §6a 交付內容 3）。
 * - `keywords.length > 5` 回錯誤（在去重之前檢查，符合規格明文的檢查順序）。
 * - 正規化後長度為 0 的關鍵字（例如純空白）整批回錯誤——不擋的話 `includes("")` 恆真，
 *   會讓該訂閱無條件命中所有新上架物品。
 * - `keywords`/`categoryIds`/`cityIds` 各自去重，避免觸發資料庫層的 unique constraint。
 * - 三個篩選維度至少要有一個非空。
 * 不在這裡驗證 categoryIds/cityIds 是否真的存在於資料庫（呼叫端有 db 連線，交給呼叫端做）。
 */
export function parseSubscriptionInput(body: unknown): ParseSubscriptionInputResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const labelRaw = typeof b.label === "string" ? b.label.trim() : "";
  const label = labelRaw.length > 0 ? labelRaw.slice(0, MAX_LABEL_LENGTH) : null;

  const immediateEnabled = b.immediateEnabled === true;
  // 預設 true（master-plan §6a：dailyDigestEnabled 預設開）；只有明確傳 false 才關閉。
  const dailyDigestEnabled = b.dailyDigestEnabled !== false;

  const rawKeywords = Array.isArray(b.keywords) ? b.keywords : [];
  if (rawKeywords.length > MAX_KEYWORDS_PER_SUBSCRIPTION) {
    return { ok: false, message: `關鍵字最多 ${MAX_KEYWORDS_PER_SUBSCRIPTION} 個` };
  }

  const keywords: { keyword: string; normalizedKeyword: string }[] = [];
  const seenNormalized = new Set<string>();
  for (const raw of rawKeywords) {
    if (typeof raw !== "string") {
      return { ok: false, message: "關鍵字格式不正確" };
    }
    const keyword = raw.trim();
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      return { ok: false, message: `單一關鍵字長度不能超過 ${MAX_KEYWORD_LENGTH} 字` };
    }
    const normalizedKeyword = normalizeKeyword(keyword);
    if (normalizedKeyword.length === 0) {
      return { ok: false, message: "關鍵字不能是空白字元" };
    }
    if (!seenNormalized.has(normalizedKeyword)) {
      seenNormalized.add(normalizedKeyword);
      keywords.push({ keyword, normalizedKeyword });
    }
  }

  const categoryIds = Array.from(
    new Set(
      Array.isArray(b.categoryIds)
        ? b.categoryIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [],
    ),
  );
  const cityIds = Array.from(
    new Set(
      Array.isArray(b.cityIds)
        ? b.cityIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [],
    ),
  );

  if (keywords.length === 0 && categoryIds.length === 0 && cityIds.length === 0) {
    return { ok: false, message: "關鍵字／分類／縣市至少要設定一項" };
  }

  return {
    ok: true,
    value: { label, immediateEnabled, dailyDigestEnabled, keywords, categoryIds, cityIds },
  };
}
