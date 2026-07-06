// M9 §9a 交付內容 3／4：票券「不可上架清單」雙重攔截的攔截層一——負責擋「類型選擇＋標題」。
// 攔截層二（自由文字：描述、留言）改用既有 `keyword_blocklist` 機制（見 keyword-blocklist.ts，
// prisma/seed.ts 已 seed「即享券」「LINE 禮物」「隨買跨店取」「行動隨時取」等詞條），不重複
// 實作。這裡專門處理表單常數清單：官方明文禁轉贈／官方閉環類型（LINE 禮物／即享券、
// 7-ELEVEN 行動隨時取、全家隨買跨店取），命中即擋，附「請走官方 App 轉贈功能」說明。

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

// 已知變體清單（正規化後的形式；normalize() 已移除空白，這裡直接寫去空白版本即可）。
const NON_TRANSFERABLE_TICKET_KEYWORDS: string[] = [
  "line即享券",
  "line禮物",
  "linegift",
  "隨買跨店取",
  "行動隨時取",
];

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
