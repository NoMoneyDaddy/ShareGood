import { db } from "@/lib/db";

// M12 產品增量（docs/plan/m12-product-growth.md 交付內容 3）：封鎖使用者——單向即生效，
// 任一方向存在封鎖關係就視為封鎖（`OR` 查詢），供 claims／direct-shares 等既有 mutation
// API 插一段檢查用。刻意做成獨立 helper（而不是直接在各 route 裡寫查詢），因為「雙向查詢」
// 這個判斷邏輯只應該有一份實作，之後如果還有其他地方要疊加封鎖檢查，直接呼叫這支就好。
//
// ⚠️ 無感知封鎖（silent block）設計：呼叫端擋下操作時務必用**通用錯誤訊息**，不要把
// 「因為被封鎖」這件事講出來（見 docs/plan/m12-product-growth.md 交付內容 3 的核心決策點）。
export async function isBlockedEitherDirection(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;

  const count = await db.userBlock.count({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
  });
  return count > 0;
}
