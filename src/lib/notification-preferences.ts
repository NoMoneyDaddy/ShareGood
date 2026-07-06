// M4 通知偏好設定（master-plan §9）。NotificationPreference.eventType 是自由字串 key，刻意
// 不綁定 NotificationType enum：這裡的目錄本身就是「支援哪些事件」的單一事實來源，之後新增
// 事件類型（例如 M3 到期 job 的 expiring_soon）只要加一筆目錄項目，不必動 schema。
//
// 預設值（master-plan §9 明訂）：站內通知全開；外部通知（M4 起 Telegram，M6 起 Web Push）
// 僅「被接受」「交接訊息」「即期提醒」這三個關鍵事件預設開，其餘預設關。
export const NOTIFICATION_EVENT_TYPES = [
  {
    eventType: "new_comment",
    label: "有人在我的物品留言",
    defaultInAppEnabled: true,
    defaultExternalEnabled: false,
  },
  {
    eventType: "claim_accepted",
    label: "我的認領或直贈邀請被接受",
    defaultInAppEnabled: true,
    defaultExternalEnabled: true,
  },
  {
    eventType: "direct_share_received",
    label: "收到直接贈送邀請",
    defaultInAppEnabled: true,
    defaultExternalEnabled: false,
  },
  {
    eventType: "handover_message",
    label: "交接對話有新訊息",
    defaultInAppEnabled: true,
    defaultExternalEnabled: true,
  },
  {
    eventType: "completion_confirmed",
    label: "分享完成確認",
    defaultInAppEnabled: true,
    defaultExternalEnabled: false,
  },
  {
    // M3 到期提醒 job 尚未實作，這裡先開放設定入口；等 M3 上線直接沿用同一把 eventType key，
    // 使用者不需要重新設定一次。
    eventType: "expiring_soon",
    label: "物品即將到期提醒",
    defaultInAppEnabled: true,
    defaultExternalEnabled: true,
  },
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]["eventType"];

const CATALOG_BY_KEY = new Map(NOTIFICATION_EVENT_TYPES.map((entry) => [entry.eventType, entry]));

export function isNotificationEventType(value: string): value is NotificationEventType {
  return CATALOG_BY_KEY.has(value as NotificationEventType);
}

export function getEventTypeDefaults(eventType: NotificationEventType) {
  // 型別已經在 isNotificationEventType 保證存在，這裡用 non-null assertion 是安全的。
  return CATALOG_BY_KEY.get(eventType)!;
}

export type ResolvedNotificationPreference = {
  eventType: NotificationEventType;
  label: string;
  inAppEnabled: boolean;
  externalEnabled: boolean;
};

type StoredPreferenceRow = {
  eventType: string;
  inAppEnabled: boolean;
  externalEnabled: boolean;
};

// 把資料庫裡「使用者實際設定過」的列與內建預設值合併：查無資料的 eventType 一律 fallback
// 回程式碼裡的預設值，不需要替每個使用者預先塞滿所有 eventType 的資料列。
export function mergeWithDefaults(rows: StoredPreferenceRow[]): ResolvedNotificationPreference[] {
  const overrides = new Map(rows.map((row) => [row.eventType, row]));
  return NOTIFICATION_EVENT_TYPES.map((def) => {
    const override = overrides.get(def.eventType);
    return {
      eventType: def.eventType,
      label: def.label,
      inAppEnabled: override?.inAppEnabled ?? def.defaultInAppEnabled,
      externalEnabled: override?.externalEnabled ?? def.defaultExternalEnabled,
    };
  });
}
