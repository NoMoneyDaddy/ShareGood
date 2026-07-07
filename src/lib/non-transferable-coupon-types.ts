// M9（master-plan §9a 交付內容 3）：不可上架清單「攔截層一」——官方明文禁轉贈券種
// （LINE 即享券），這不是「內容違規」而是「這個券種本來就不該出現在這個平台」，正確做法
// 是引導使用者走官方轉贈功能，所以獨立於 keyword_blocklist（攔截層二，負責擋自由文字裡
// 的加價/折現/個資徵求詞），用程式內定的常數清單擋「類型選擇＋標題」。
//
// 正規化：去空白、全形轉半形、英文小寫化，之後用子字串比對——「LINE即享券」「LINE 即享券」
// 「line即享券」都會正規化成同一個字串，不需要每個變體各自列一次。
const FULLWIDTH_OFFSET = 0xfee0;

export function normalizeForCouponTypeCheck(text: string): string {
  return text
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET))
    .replace(/　/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// 使用者 2026-07-07 拍板：不可上架清單**全面清空**——LINE 即享券、LINE 禮物、隨買跨店取、
// 行動隨時取一律不在上架時硬擋，官方閉環/禁轉贈類改以詳情頁文案引導官方轉贈功能，
// 「能否轉讓依發行人條款」的風險提示由法務文案承擔。機制與正規化邏輯保留：日後若要恢復
// 硬擋，把詞條加回本清單（程式層）或從後台 /admin/keyword-blocklist 加詞（資料層）皆可。
export const NON_TRANSFERABLE_COUPON_TYPES: readonly string[] = [];

/**
 * 檢查文字是否命中不可上架清單，命中回傳命中的原始詞條（未正規化），否則回傳 null。
 */
export function checkNonTransferableCouponType(text: string): string | null {
  if (!text) return null;
  const normalized = normalizeForCouponTypeCheck(text);
  for (const term of NON_TRANSFERABLE_COUPON_TYPES) {
    if (normalized.includes(normalizeForCouponTypeCheck(term))) {
      return term;
    }
  }
  return null;
}
