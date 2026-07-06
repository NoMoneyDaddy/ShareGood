import { RestrictionType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

// M2 治理底線 §7「功能限制」：對使用者禁上架/禁留言/禁私訊（可設期限）；封鎖（全站唯讀）。
// 這支 helper 統一在 API 層檢查，供上架／留言／私訊三支既有 API 各自插一段檢查用。
export type RestrictionAction = "posting" | "claiming" | "messaging";

const ACTION_TYPE: Record<RestrictionAction, RestrictionType> = {
  posting: RestrictionType.no_posting,
  claiming: RestrictionType.no_claiming,
  messaging: RestrictionType.no_messaging,
};

const ACTION_LABEL: Record<RestrictionAction, string> = {
  posting: "上架",
  claiming: "留言",
  messaging: "私訊",
};

export type RestrictionCheckResult = { blocked: false } | { blocked: true; message: string };

/**
 * 查詢該使用者是否有對應且未過期、未被提前解除的限制（`full_block` 對任何 action 都擋）。
 * `expiresAt` null 代表永久；`liftedAt` 非 null 代表已被 admin/moderator 提前解除。
 */
export async function checkUserRestriction(
  userId: string,
  action: RestrictionAction,
): Promise<RestrictionCheckResult> {
  const now = new Date();
  const restriction = await db.userRestriction.findFirst({
    where: {
      userId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      type: { in: [ACTION_TYPE[action], RestrictionType.full_block] },
    },
    select: { type: true },
    orderBy: { createdAt: "desc" },
  });

  if (!restriction) return { blocked: false };

  if (restriction.type === RestrictionType.full_block) {
    return {
      blocked: true,
      message: "您的帳號目前被停權，如有疑問請聯繫站方",
    };
  }

  return {
    blocked: true,
    message: `您的帳號目前被限制${ACTION_LABEL[action]}，如有疑問請聯繫站方`,
  };
}

/**
 * 全站唯讀檢查：`full_block` 的定義是「封鎖使用者的所有 mutation」，不侷限於上架/留言/私訊
 * 這三個具名限制。上面三支既有 API 已經靠 `checkUserRestriction` 順帶擋到 full_block，
 * 這支給其餘會寫入資料的 API（直贈、交接、感謝、通知已讀、個人資料、上傳等）疊加一段同樣的
 * 檢查，讓「被封鎖者所有 mutation 皆 403」這條驗收在全站成立，而不必為它們各自發明一個
 * 不存在的 RestrictionAction。
 */
export async function checkFullBlock(userId: string): Promise<RestrictionCheckResult> {
  const now = new Date();
  const restriction = await db.userRestriction.findFirst({
    where: {
      userId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      type: RestrictionType.full_block,
    },
    select: { id: true },
  });

  if (!restriction) return { blocked: false };
  return {
    blocked: true,
    message: "您的帳號目前被停權，如有疑問請聯繫站方",
  };
}
