// 資料保留政策的後台顯示對照表（/admin/data 用來把 action／targetType 這些內部代碼
// 轉成管理員看得懂的白話，資料庫欄位本身仍存英文代碼不變）。
//
// 刻意獨立成檔、不放進 src/lib/retention.ts：retention.ts 引用了 db／storage 等
// server-only 模組，而這份對照表也要給 client component（retention-policy-row.tsx）
// 使用，放在一起會把 Prisma client 拖進瀏覽器 bundle。
export const RETENTION_ACTION_LABEL: Record<string, string> = {
  purge: "完全刪除",
  anonymize: "去識別化",
  downgrade: "降級保留（只留縮圖／摘要）",
  archive: "標記歸檔",
};

export const RETENTION_TARGET_TYPE_LABEL: Record<string, string> = {
  notification: "站內通知",
  telegram_update: "Telegram 訊息去重紀錄",
  web_push_subscription: "瀏覽器推播訂閱裝置",
  item_image: "物品圖片",
  message: "私訊訊息",
  report_evidence: "檢舉證據圖片",
  appeal_evidence: "申訴證據圖片",
};
