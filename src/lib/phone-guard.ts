// M9 §9a 交付內容 5：點數類型個資最小化（硬規則）——不記錄任何會員帳號／手機號／驗證碼。
// `checkKeywordBlocklist`（src/lib/keyword-blocklist.ts）只做子字串比對，能攔「驗證碼」
// 「會員帳號」「OTP」等固定詞，但攔不了「格式」（例如台灣手機號本身），因此這裡另外實作一支
// 獨立的正則檢查 helper，只套用在點數類的表單欄位與留言內容（見呼叫端：
// src/app/api/items/route.ts、src/app/api/items/[id]/claims/route.ts、
// src/app/api/conversations/[id]/messages/route.ts）。

// 全形數字／全形空白轉半形，讓「０９１２３４５６７８」「０９１２　３４５　６７８」這類變體也能被
// 底下的半形數字正則抓到；不動其他全形符號（避免誤傷正常中文標點）。
const FULLWIDTH_DIGITS = "０１２３４５６７８９";

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String(FULLWIDTH_DIGITS.indexOf(ch))).replace(/　/g, " ");
}

// 台灣手機號：09 開頭共 10 碼數字，允許 "-"、"."、空白 分隔（例："0912345678"／
// "0912-345-678"／"0912 345 678"），也接受 +886/886 國際碼變體（國際碼後面接的號碼不含開頭 0）。
const TAIWAN_MOBILE_PATTERN = /(?:(?:\+?886[-.\s]?)9|09)\d{2}[-.\s]?\d{3}[-.\s]?\d{3}(?!\d)/;

/**
 * 文字內是否含疑似台灣手機號（含全形數字／分隔符變體）。命中回傳 true，呼叫端自行決定
 * 錯誤訊息與狀態碼（本專案慣例：422 UNPROCESSABLE）。
 */
export function containsTaiwanMobileNumber(text: string): boolean {
  if (!text) return false;
  return TAIWAN_MOBILE_PATTERN.test(toHalfWidthDigits(text));
}
