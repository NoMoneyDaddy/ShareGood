import type { Prisma } from "@/generated/prisma/client";

// 帳號刪除去識別化（master-plan §7a 交付內容 3）：User 資料列永遠不被實際 DELETE，只把可
// 識別欄位改寫成佔位內容，id 不變，所有既有 FK 關聯完全不受影響——這是應用層的資料改寫，
// 不是 schema 層的刪除策略（設計理由見規格文件，這裡不重複貼一次）。
//
// ⚠️ 法律免責聲明：以下「哪些欄位算可識別個資、要不要一併下架已上架物品」的具體範圍認定，
// 僅為技術實作參考，正式營運前需台灣律師與平台法務審閱（見 master-plan.md §7a 節首聲明）。

export const DELETED_USER_PLACEHOLDER_NAME = "已刪除的使用者";

export function deletedUserPlaceholderEmail(userId: string): string {
  // .invalid 是 IANA 保留的無效網域（RFC 2606），不會誤發信，同時維持 email @unique 約束合法。
  return `deleted-${userId}@sharegood.invalid`;
}

/**
 * 在一個既有 transaction 內執行去識別化改寫。呼叫端負責：
 * 1. 事先確認沒有命中 legal hold（`isUnderLegalHold("user", userId)`）。
 * 2. transaction 成功後自行寫入 `audit_logs`（這裡不寫，保持這個函式單純只做資料改寫，
 *    audit log 的 actor/detail 由呼叫端決定，例如系統排程 vs 未來可能的人工介入）。
 */
export async function deidentifyUser(tx: Prisma.TransactionClient, userId: string, now: Date) {
  await tx.user.update({
    where: { id: userId },
    data: {
      name: DELETED_USER_PLACEHOLDER_NAME,
      email: deletedUserPlaceholderEmail(userId),
      image: null,
      emailVerified: null,
      deletedAt: now,
    },
  });

  // Profile 理論上一定存在（onboarding 必建），但用 updateMany 而不是 update：即使某個測試
  // 或極端情況下沒有 Profile，這裡也不該讓整個去識別化 transaction 因為找不到列而失敗。
  await tx.profile.updateMany({
    where: { userId },
    data: { nickname: DELETED_USER_PLACEHOLDER_NAME, bio: null },
  });

  // Account／Session／UserRole：真的刪除（不是改寫）。帳號已刪除不該再能登入，這兩張表
  // 只服務登入用途，刪除後對其他使用者資料無任何影響；UserRole 一併刪除避免去識別化後的
  // 帳號還保留 admin/moderator 權限。
  await tx.account.deleteMany({ where: { userId } });
  await tx.session.deleteMany({ where: { userId } });
  await tx.userRole.deleteMany({ where: { userId } });

  // 已上架（published）的物品強制轉 removed_by_user，避免已刪帳號的物品繼續掛在列表上；
  // 其餘狀態（draft/reserved/handover_pending/completed/expired/...）維持原樣，交接中的
  // 物品不該被這個動作打斷。逐筆處理才能各自留一筆 ItemStatusLog。
  const publishedItems = await tx.item.findMany({
    where: { ownerId: userId, status: "published" },
    select: { id: true },
  });
  for (const item of publishedItems) {
    await tx.item.update({ where: { id: item.id }, data: { status: "removed_by_user" } });
    await tx.itemStatusLog.create({
      data: {
        itemId: item.id,
        fromStatus: "published",
        toStatus: "removed_by_user",
        actorId: null,
        reason: "帳號刪除去識別化，物品自動下架",
      },
    });
  }

  // M12 產品增量三張新使用者行為表的去識別化處理（docs/plan/m12-product-growth.md「核心表
  // 變更的相容性風險」節點名的已知缺口，這裡補上）。判斷原則比照既有 ClaimComment／Message／
  // ThanksMessage 的既定做法：「別人看得到、屬於歷史紀錄一部分」的內容不動；「純粹屬於這個
  // 使用者自己的行為/偏好資料、對他人沒有紀錄完整性意義」的則整批清除，呼應資料刪除權精神。
  //
  // - HandoverRating：不刪、不改寫。評分（stars/comment）是雙方交接歷史的一部分，比照既有
  //   ClaimComment/ThanksMessage 先例保留；rater/ratee 的 FK 都指向 User，User 列本身已經
  //   去識別化（name/email 已改寫），不會再洩漏可識別資訊。若砍掉「這個使用者評分過的紀錄」，
  //   會不公平地抹掉對方（ratee）應得的評價歷史（例如接手者已刪帳號，物主收到的星等不該
  //   連帶消失）。
  // - ItemFavorite：整批刪除。收藏清單是這個使用者單方面的興趣/瀏覽偏好資料，不對任何其他
  //   使用者呈現「是誰收藏的」（規格明定只顯示彙總數字），清除後只會讓對應物品的「已有 N 人
  //   收藏」計數同步減少，不影響任何他人可見的歷史紀錄完整性；保留下去只是無意義地累積已刪
  //   帳號的行為資料。
  // - UserBlock：整批刪除（不論 blockerId 或 blockedId 是這個使用者）。封鎖是使用者對使用者
  //   的私人安全選擇，帳號去識別化後既不能登入也無法再與任何人互動，這段關係資料已無實質
  //   作用；比照 Account/Session/UserRole 用「真的刪除」處理（而非改寫），因為它不像
  //   ClaimComment 那樣涉及「對方應得的歷史紀錄」。
  await tx.itemFavorite.deleteMany({ where: { userId } });
  await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
}
