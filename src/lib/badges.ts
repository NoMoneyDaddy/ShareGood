// 徽章系統（正式上線衝刺：貢獻值排行榜＋徽章）——純計算，不改 schema、不新增資料表。
// 兩種徽章各自獨立判斷，呼叫端（src/components/user-badge.tsx）決定要不要同時顯示：
// 1. 貢獻值等級徽章：依累計貢獻值級距顯示，數值來源見 src/lib/contribution.ts。
// 2. 身份組徽章：admin/moderator 專屬，一般 user 不顯示（沒有徽章可拿，不是顯示空徽章）。

export type ContributionBadgeKey = "sprout" | "warm" | "expert" | "legend";

export type ContributionBadgeTier = {
  key: ContributionBadgeKey;
  minPoints: number;
  label: string;
  description: string;
};

// 級距數字為工程預設草案（比照 give-to-get-quota.ts 級距的既有做法，之後可依真實分佈
// 微調，呼叫端不必改）：≥10 新芽夥伴、≥50 熱心夥伴、≥150 共享達人、≥500 傳奇鄰居。
// 由高到低排序，getContributionBadge 用 find 取第一個達標的級距即為目前等級。
export const CONTRIBUTION_BADGE_TIERS: readonly ContributionBadgeTier[] = [
  {
    key: "legend",
    minPoints: 500,
    label: "傳奇鄰居",
    description: "累計貢獻值達 500，長期熱心分享，是社群裡的傳奇人物。",
  },
  {
    key: "expert",
    minPoints: 150,
    label: "共享達人",
    description: "累計貢獻值達 150，是值得信賴的分享達人。",
  },
  {
    key: "warm",
    minPoints: 50,
    label: "熱心夥伴",
    description: "累計貢獻值達 50，樂於分享的熱心夥伴。",
  },
  {
    key: "sprout",
    minPoints: 10,
    label: "新芽夥伴",
    description: "累計貢獻值達 10，剛在社群裡發芽茁壯。",
  },
];

/** 依累計貢獻值找出目前達到的最高等級徽章；未達最低級距（10）則回傳 null（不顯示徽章）。 */
export function getContributionBadge(points: number): ContributionBadgeTier | null {
  return CONTRIBUTION_BADGE_TIERS.find((tier) => points >= tier.minPoints) ?? null;
}

export type PlatformRole = "user" | "moderator" | "admin";

export type RoleBadgeInfo = {
  role: Extract<PlatformRole, "admin" | "moderator">;
  label: string;
};

const ROLE_BADGE_LABEL: Record<"admin" | "moderator", string> = {
  admin: "管理團隊",
  moderator: "社群管理",
};

// 呼叫端有的傳 UserRole[]（{ role: string }[]），有的（例如 API 回應序列化後）只剩
// role 字串陣列，這裡兩種型態都接受，減少呼叫端各自轉換的重複程式碼。
type RoleInput = readonly { role: string }[] | readonly string[];

function normalizeRoles(roles: RoleInput): string[] {
  // 防禦：型別上是陣列，但呼叫端若把序列化後意外變 null/undefined 的資料傳進來，
  // 直接 .map 會整個渲染路徑崩潰；非陣列一律當「沒有身份組」處理。
  if (!Array.isArray(roles)) return [];
  return roles.map((r) => (typeof r === "string" ? r : r.role));
}

/**
 * 身份組徽章：admin 隱含 moderator 權限，兩者都有時只顯示 admin（跟
 * src/lib/support-tickets.ts 的 isModeratorOrAdmin 判斷邏輯一致）。一般 user 回傳 null。
 */
export function getRoleBadge(roles: RoleInput): RoleBadgeInfo | null {
  const names = normalizeRoles(roles);
  if (names.includes("admin")) return { role: "admin", label: ROLE_BADGE_LABEL.admin };
  if (names.includes("moderator")) return { role: "moderator", label: ROLE_BADGE_LABEL.moderator };
  return null;
}
