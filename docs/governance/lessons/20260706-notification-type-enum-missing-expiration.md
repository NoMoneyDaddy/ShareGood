# M3 到期 job 要通知物主，但 `NotificationType` enum 沒有涵蓋「到期／即將到期」事件，而任務明確要求不能動 schema

- 日期：2026-07-06
- 情境：`feat/m3-expiration-job`，實作 `POST /api/jobs/expiration-check`（master-plan.md §8）。
  規格要求「過期物品轉 `expired`＋通知物主」「即將到期（3 天前）提醒」，兩者都要寫進既有的
  `Notification` 表。
- 卡點：`prisma/schema.prisma` 的 `NotificationType` enum（M1 建立，見
  `prisma/migrations/20260706005044_m1_core_loop/migration.sql`）只有五個值：
  `new_comment`／`claim_accepted`／`direct_share_received`／`handover_message`／
  `completion_confirmed`。M2-M4 schema 地基（PR #16）加了 `ItemExpirationLog`／`SystemJob`／
  `SystemJobRun` 給到期 job 用，卻沒有同步替 `NotificationType` 加上對應的值——這是 schema PR
  的遺漏，但本次任務的指令明確寫「不需要也不應該修改 schema.prisma」「不要跑任何 migration」，
  是硬限制，不能為了補這個洞就破例。
- 檢查過的替代方案：
  1. 硬塞一個語意不符的既有值（例如 `claim_accepted`）——會讓 `/notifications` 頁面的
     `describeNotification` 顯示完全錯誤的文字（例如到期下架卻顯示「已經確定給你了！」），
     使用者會被誤導，不能接受。
  2. 加新的 enum 值——違反本次任務的硬限制。
  3.（採用）借用既有值當「type 佔位」，把真正的事件種類放進 `payload`，前端顯示邏輯
     改成優先讀 `payload` 裡的識別欄位，不受佔位 type 影響。
- 作法：`src/app/api/jobs/expiration-check/route.ts` 用 `"handover_message"`（語意上最接近
  「物品相關的系統訊息」）當 `Notification.type`，payload 多帶一個
  `expirationAction: "expired" | "reminder_sent"`。`src/app/notifications/page.tsx` 的
  `describeNotification` 改成先檢查 `payload.expirationAction`，命中就直接回對應文字，
  完全略過 `switch (type)`；沒有這個欄位的通知（M1 既有五種）行為不受影響。
- 引申規則：**要新增一種通知事件、但這次任務被明確禁止改 schema 時，先看能不能用「既有 enum
  值當佔位＋payload 攜帶真實事件種類＋顯示層改成 payload-first 判斷」解決**，不要因為 enum
  卡住就自行放寬「不改 schema」這條限制，也不要為了圖方便硬塞語意不符的值造成使用者看到錯誤
  文字。下一次有機會動 `NotificationType` schema 時（例如做 M4 通知強化），應該把
  `item_expired`／`item_expiring_soon` 補進 enum，並把這裡的 payload-first 判斷式一併換成
  正式的 `case` 分支、把佔位邏輯清掉。
