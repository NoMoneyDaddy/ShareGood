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

// 清單已內含常見變體字面（未正規化前的原文，方便閱讀），比對時雙方都會先正規化。
// 注意一：刻意不收裸詞「即享券」——那是 Edenred 的通用電子票券品牌（麥當勞/SOGO/家樂福
// 即享券等），多數為可自由轉贈的序號券，正是本平台利基；研究 04 查證到的「官方明文
// 禁轉贈」僅限 LINE 即享券。
// 注意二：使用者 2026-07-07 拍板——「LINE 禮物」「隨買跨店取」「行動隨時取」不攔截
// （官方閉環類以詳情頁文案引導官方轉贈功能，不在上架時硬擋），本清單僅保留 LINE 即享券。
export const NON_TRANSFERABLE_COUPON_TYPES: readonly string[] = ["LINE即享券"];

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
