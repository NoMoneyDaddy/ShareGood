// M9 §9a 交付內容 3／4：票券「不可上架清單」雙重攔截的攔截層一——負責擋「類型選擇＋標題」。
// 攔截層二（自由文字：描述、留言）改用既有 `keyword_blocklist` 機制（見 keyword-blocklist.ts，
// prisma/seed.ts 已 seed「LINE即享券」「LINE 即享券」詞條），不重複實作。這裡專門處理表單
// 常數清單：官方明文禁轉贈券種（LINE 即享券），命中即擋，附「請走官方 App 轉贈功能」說明。
// 使用者 2026-07-07 拍板：「LINE 禮物」「隨買跨店取」「行動隨時取」不攔截（官方閉環類以
// 詳情頁文案引導官方轉贈功能，不在上架時硬擋）。

// 正規化：全形轉半形（含全形英數與全形空白）、trim、轉小寫、移除所有空白——讓
// 「LINE即享券」「LINE 即享券」「line即享券」「line gift」等已知變體都能命中同一份清單，
// 不需要窮舉每一種空白/大小寫組合。
function normalize(text: string): string {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 使用者 2026-07-07 拍板：不可上架清單**全面清空**（含 LINE 即享券），不在上架時硬擋，
// 改以詳情頁文案引導官方轉贈功能。機制保留：日後要恢復硬擋，把正規化後的詞條加回即可。
const NON_TRANSFERABLE_TICKET_KEYWORDS: string[] = [];

/**
 * 文字（券種／標題）是否命中「不可上架」清單（官方明文禁轉贈／官方閉環類型）。
 * 命中回傳該詞條（正規化後），否則回傳 null。
 */
export function checkNonTransferableTicketType(text: string): string | null {
  if (!text) return null;
  const normalized = normalize(text);
  for (const keyword of NON_TRANSFERABLE_TICKET_KEYWORDS) {
    if (normalized.includes(keyword)) return keyword;
  }
  return null;
}
