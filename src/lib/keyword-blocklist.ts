import { db } from "@/lib/db";

// M2 治理底線（master-plan.md §7）：關鍵字黑名單，攔上架標題／描述與留言內容。
// `keyword_blocklist` 表已在 schema 地基（PR #16）建好，這裡只補查詢邏輯：
// 大小寫不敏感、子字串命中即擋（不做分詞/模糊比對，MVP 先簡單可靠）。

/**
 * 檢查文字是否命中任何啟用中的黑名單關鍵字，命中回傳該關鍵字，否則回傳 null。
 * 呼叫端可以把回傳值直接塞進錯誤訊息，或只用來判斷真假。
 */
export async function checkKeywordBlocklist(text: string): Promise<string | null> {
  if (!text) return null;
  const keywords = await db.keywordBlocklist.findMany({
    where: { isActive: true },
    select: { keyword: true },
  });
  const lower = text.toLowerCase();
  for (const { keyword } of keywords) {
    if (keyword && lower.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}
