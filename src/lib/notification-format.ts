// 把一則站內通知（Notification.type + payload）組成一句外部推播用的文字（Telegram／
// Web Push 共用）。刻意跟 src/app/notifications/page.tsx 的 `describeNotification`（站內
// 顯示用、含 mergedCount 聚合文案）分開維護一份精簡版：外部推播只需要一句「發生了什麼、
// 去哪看」，不需要頁面版那些聚合細節；但兩邊的判別邏輯（payload.kind 優先、再看
// NotificationType）刻意對齊，避免同一事件兩處語意打架。
//
// 全站沿用「重用少數 NotificationType enum 值 + payload.kind 判別」的既定做法（見
// src/app/notifications/page.tsx 的說明）：M2 強制下架、M3 到期、M5 抽籤、M6 訂閱都把新
// 事件塞進 completion_confirmed／handover_message 這些既有 type，靠 payload.kind 區分，
// 不新增 enum 值（維持 prisma/schema.prisma 不動）。這裡因此必須先看 kind，再 fallback 回 type。

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function itemTitleOf(p: Record<string, unknown>): string {
  return typeof p.itemTitle === "string" && p.itemTitle ? p.itemTitle : "這個物品";
}

const PREFIX = "【好物共享】";

// M12 交付內容 5（面交約定時間）：payload.scheduledAt 是 ISO 字串，外部推播文字用台北時間
// 顯示（master-plan §3.4 全站時區慣例），格式化失敗（不是合法日期）就不附時間字樣。
const TAIPEI_TIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

function formatScheduledAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return TAIPEI_TIME_FORMATTER.format(date);
}

/**
 * 組出外部推播（Telegram／Web Push body）用的一句話。回傳值一律帶「好物共享」前綴，讓
 * 使用者一眼認得來源。未知的 kind／type 一律回保底文字，不會因為未來新增事件忘記處理就
 * 送出空字串。
 */
export function formatNotificationText(type: string, payload: unknown): string {
  const p = asRecord(payload);
  const title = itemTitleOf(p);

  switch (p.kind) {
    case "item_force_removed":
      return `${PREFIX}你的物品「${title}」已被管理員下架，可到網站查看原因或提出申訴`;
    case "item_expired":
      return `${PREFIX}「${title}」已到期下架，之後可以重新上架分享`;
    case "item_expiring_reminder":
      return `${PREFIX}「${title}」即將到期，記得儘快促成分享`;
    case "lottery_won":
      return `${PREFIX}恭喜！你在「${title}」的抽籤中獲選了，請於 48 小時內登入網站確認`;
    case "lottery_drawn":
      return `${PREFIX}「${title}」已完成開獎，正在等待中選者確認`;
    case "lottery_backup_offered":
      return `${PREFIX}「${title}」的抽籤遞補到你了，請於 48 小時內登入網站確認`;
    case "lottery_progress":
      return `${PREFIX}「${title}」的抽籤正在遞補下一位候選人`;
    case "lottery_failed":
      return `${PREFIX}「${title}」的抽籤流標了，已恢復開放，可改用留言或直贈分享`;
    case "lottery_cancelled":
      return `${PREFIX}你參加的「${title}」抽籤已被物主取消`;
    case "subscription_match": {
      const label =
        typeof p.subscriptionLabel === "string" && p.subscriptionLabel
          ? p.subscriptionLabel
          : "條件";
      return `${PREFIX}你訂閱的「${label}」有新物品：${title}`;
    }
    case "subscription_digest": {
      const total = typeof p.totalCount === "number" ? p.totalCount : 0;
      return `${PREFIX}今天有 ${total} 件符合你訂閱條件的新物品，登入網站查看摘要`;
    }
    // M12（docs/plan/m12-product-growth.md 交付內容 2）：收藏提醒，見 src/lib/favorites.ts。
    case "favorite_item_claimed":
      return `${PREFIX}你收藏的「${title}」已經被別人接走了`;
    case "favorite_item_expiring":
      return `${PREFIX}你收藏的「${title}」即將到期`;
    case "handover_meetup_reminder": {
      const scheduledLabel = formatScheduledAt(p.scheduledAt);
      return `${PREFIX}「${title}」的約定面交時間快到了${scheduledLabel ? `（${scheduledLabel}）` : ""}`;
    }
  }

  switch (type) {
    case "new_comment":
      return `${PREFIX}有人在你的物品「${title}」留言了，登入網站查看`;
    case "claim_accepted":
      return `${PREFIX}「${title}」已經確定給你了！`;
    case "direct_share_received":
      return `${PREFIX}你收到一份直接贈與：「${title}」`;
    case "handover_message":
      return `${PREFIX}「${title}」有新的交接訊息`;
    case "completion_confirmed":
      return `${PREFIX}「${title}」已完成分享，記得留言感謝對方！`;
    default:
      return `${PREFIX}你有一則新通知，登入網站查看`;
  }
}
