import { Award, Crown, Flame, type LucideIcon, ShieldCheck, Sprout } from "lucide-react";
import { type ContributionBadgeKey, getContributionBadge, getRoleBadge } from "@/lib/badges";
import { cn } from "@/lib/utils";

// 徽章 pill 元件：貢獻值等級徽章＋身份組徽章，共用同一套小型 pill 視覺語言。全部用
// globals.css 既有語意 token（success/warning/danger/brand-accent 等，這批目前全站
// 零引用），不新增任何顏色變數。純展示用途、非互動元件，不受 44px 觸控目標規範限制。

const TIER_ICON: Record<ContributionBadgeKey, LucideIcon> = {
  sprout: Sprout,
  warm: Flame,
  expert: Award,
  legend: Crown,
};

// 由淺入深：新芽（成長／綠）→熱心（品牌靛青）→達人（琥珀，成就感）→傳奇（暖沙金，
// 呼應 brand-accent 本身就是「提案 B」的輔助色，等級越高視覺越接近品牌強調色）。
const TIER_STYLE: Record<ContributionBadgeKey, string> = {
  sprout: "bg-success/10 text-success",
  warm: "bg-brand/10 text-brand-ink",
  expert: "bg-warning/15 text-warning",
  legend: "bg-brand-accent/15 text-brand-accent-ink",
};

type BadgeSize = "sm" | "md";

const SIZE_TEXT: Record<BadgeSize, string> = { sm: "text-[11px]", md: "text-xs" };
const SIZE_ICON: Record<BadgeSize, number> = { sm: 11, md: 13 };

type RoleInput = Parameters<typeof getRoleBadge>[0];

/** 貢獻值等級徽章；累計貢獻值未達最低級距（10）時不顯示任何東西。 */
export function ContributionBadge({
  points,
  size = "sm",
  className,
}: {
  points: number;
  size?: BadgeSize;
  className?: string;
}) {
  const tier = getContributionBadge(points);
  if (!tier) return null;
  const Icon = TIER_ICON[tier.key];
  return (
    <span
      title={tier.description}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium",
        SIZE_TEXT[size],
        TIER_STYLE[tier.key],
        className,
      )}
    >
      <Icon size={SIZE_ICON[size]} strokeWidth={2.2} aria-hidden="true" />
      {tier.label}
    </span>
  );
}

/** 身份組徽章；一般 user 不顯示（沒有徽章可拿），admin 用實色底比 moderator 更顯眼。 */
export function RoleBadge({
  roles,
  size = "sm",
  className,
}: {
  roles: RoleInput;
  size?: BadgeSize;
  className?: string;
}) {
  const badge = getRoleBadge(roles);
  if (!badge) return null;
  const isAdmin = badge.role === "admin";
  return (
    <span
      title={isAdmin ? "官方管理團隊成員" : "社群管理志工／人員"}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium",
        SIZE_TEXT[size],
        isAdmin ? "bg-brand text-brand-foreground" : "bg-brand-soft text-brand-ink",
        className,
      )}
    >
      <ShieldCheck size={SIZE_ICON[size]} strokeWidth={2.2} aria-hidden="true" />
      {badge.label}
    </span>
  );
}

/** 身份組徽章＋貢獻值徽章一起顯示的便利元件（常見組合：暱稱旁邊、留言者旁邊）。 */
export function UserBadges({
  roles,
  points,
  size = "sm",
  className,
}: {
  roles: RoleInput;
  points: number;
  size?: BadgeSize;
  className?: string;
}) {
  const roleBadge = getRoleBadge(roles);
  const contributionTier = getContributionBadge(points);
  if (!roleBadge && !contributionTier) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <RoleBadge roles={roles} size={size} />
      <ContributionBadge points={points} size={size} />
    </span>
  );
}
