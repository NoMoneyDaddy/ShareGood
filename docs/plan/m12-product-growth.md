# M12 — 產品成長與信任機制強化（草案，待使用者確認）

> **本章為草案，經使用者確認前不得實作**（比照 M5–M9：規格先行、核准才動工）。研究依據：
> `docs/research/2026-07-07-launch/market-best-practices.md` 五視角上線前審計，B 級機會
> B1（雙向互評）／B2（封鎖使用者）／B3（收藏）／B5（面交前提醒）四項，加上使用者另外核准的
> 排行榜 opt-out、產品成長儀表板、供給側批量上架，合計 7 項，使用者已拍板「全做」。

**目標**：把上線前審計挖出的留存與信任機會，落成可執行的 schema 與功能規格。七項裡五項要動
schema（一次到位，避免像 M2/M3/M4 schema 凍結後才發現漏欄位的窘境），兩項純查詢/UI 不動 schema。

**依賴**：
- M1（`items`／`claim_comments`／`direct_shares`／`handover_records`／`contribution_events`／
  `notifications`／`conversations`）：五個動 schema 的功能全部掛在既有交接與物品狀態機上，
  不新增狀態機、不改既有轉換路徑。
- M2（`user_restrictions`、`keyword_blocklist`、rate limit）：封鎖使用者與批量上架都疊加在
  既有的限制檢查／黑名單／rate limit 機制上，不重造。
- M4（`notification_preferences`）：新事件類型比照 M6 `subscription-notify.ts` 的「先查偏好
  才建立站內通知」模式（見交付內容 1/2/5 的通知設計）。
- M8（`/admin/ops` 頁面結構與 `percentile_cont` 查詢慣例）：產品成長儀表板照抄這個模式。
- M9（`categories.ts` slug 判別模式、`rate-limit.ts` 既有 action 清單）：批量上架與部分决策點沿用。

**現況校正（開工前必讀）**：審計報告 A2/A3（公開個人頁補「加入時間」與「已完成分享/接手次數」、
物品詳情頁顯示物主信任訊號）與排行榜頁（`/leaderboard`）**已經上線**（非本章交付，`src/lib/
contribution.ts` 的 `getUserSharingStats`、`src/app/(shell)/u/[userId]/page.tsx`、`src/app/
(shell)/leaderboard/page.tsx` 皆已存在）——本章各功能的前端呈現直接疊加在這些既有頁面上，
不重造。

---

## 0. 共通設計決策（已拍板，適用全章）

1. **命名與慣例**：新表 `snake_case` 複數＋`@@map`，欄位 camelCase＋`@map` snake_case，`id`
   一律 `cuid()`，比照 §3.1／既有全部表的既定風格。
2. **通知重用既有機制、不新增 `NotificationType` enum 值**：延續 M3/M5/M6/M9 的既定做法——
   新事件一律重用 `completion_confirmed`＋`payload.kind` 判別欄位。**與既有做法的一處刻意
   改進**：M1–M3 時期的通知（`item-expiration` job、`thanks`）建立站內通知前不查
   `NotificationPreference`（`db.notification.create` 直接寫入，偏好只影響外部派送），M6
   `subscription-notify.ts` 才第一次把「先查 `inAppEnabled` 才建立站內通知」的模式做對。
   本章四個新事件（收藏提醒、面交提醒、互評通知）**一律採用 M6 這個較嚴謹的模式**，因此
   建議把 `subscription-notify.ts` 裡 `resolvePreference`＋`createSubscriptionNotificationIfEnabled`
   的邏輯抽成 `src/lib/notifications.ts` 的通用 helper（例如
   `createPreferenceGatedNotification`），本章與既有 M6 呼叫端一起改用，避免第三次複製貼上
   同一段邏輯。這屬於「品質改進」而非本章验收硬要求，若時間不足可先各自複製一份（比照
   M2 對小型 helper 的既定容忍度），但務必留 TODO 註解註明。
3. **新事件類型需登記進 `NOTIFICATION_EVENT_TYPES` 目錄**（`src/lib/notification-preferences.ts`）：
   讓使用者能在 `/me/notification-preferences` 個別開關（見各交付內容的建議預設值）。
4. **權限檢查沿用既有 helper**：mutation 一律 `requireUser()`＋`checkFullBlock()`／
   `checkUserRestriction()`，不重新發明。
5. **列表查詢一律分頁**（cursor-based，預設 20/上限 50，比照 §3.2）。

---

## 交付內容

### 1. 雙向互評（Mutual Rating）

**定位**：交接完成（`HandoverRecord.status = completed`）後，物主與接手者各自可對另一方留一次
1–5 星評分＋可選文字評語，是「信任分數」的前置資料（審計 B1，暫不做 C1 綜合信任分數）。

**schema**：新表 `handover_ratings`：
```
model HandoverRating {
  id               String   @id @default(cuid())
  handoverRecordId String   @map("handover_record_id")
  raterId          String   @map("rater_id")   -- 給分的人
  rateeId          String   @map("ratee_id")   -- 被評分的人
  stars            Int                          -- 1–5，範圍靠 API 層驗證，schema 不加 CHECK
  comment          String?                      -- 選填，比照 ThanksMessage.message 的長度限制
  createdAt        DateTime @default(now()) @map("created_at")

  handoverRecord HandoverRecord @relation(fields: [handoverRecordId], references: [id], onDelete: Cascade)
  rater          User           @relation("HandoverRatingRater", fields: [raterId], references: [id], onDelete: Cascade)
  ratee          User           @relation("HandoverRatingRatee", fields: [rateeId], references: [id], onDelete: Cascade)

  @@unique([handoverRecordId, raterId])  -- 一筆交接每個人只能評一次（雙向各自受這條約束）
  @@index([rateeId, createdAt])          -- 個人頁聚合查詢（平均星等＋則數）
  @@map("handover_ratings")
}
```
`HandoverRecord` 加 `ratings HandoverRating[]`；`User` 加
`handoverRatingsGiven HandoverRating[] @relation("HandoverRatingRater")`／
`handoverRatingsReceived HandoverRating[] @relation("HandoverRatingRatee")`。

**API**：
- `POST /api/handover/[id]/ratings`：body `{ stars: number, comment?: string }`。
  - 權限：`user.id` 須為該 `HandoverRecord` 的物主或接手者；`rateeId` 自動判定為「另一方」。
  - 前置條件：`handoverRecord.status === "completed"`（未完成一律 409，比照 `thanks` route
    「還沒完成分享，無法留言感謝」的既定錯誤文案風格）。
  - `stars` 須為 1–5 整數（422）；`comment` 若有，1–300 字，且過 `checkKeywordBlocklist`
    （自由文字，比照留言/描述的既定做法）。
  - 防重複：直接 `create`，撞 `@@unique([handoverRecordId, raterId])` 的 P2002 捕捉回 409
    （比照 `thanks` route 的既定寫法，不先 `findFirst`）。
  - 通知：對 `rateeId` 建立 `handover_rating_received` 事件（見決策 2），reuse
    `completion_confirmed`＋`payload.kind: "handover_rating_received"`。
- `GET /api/handover/[id]/ratings`：回傳這筆交接雙方各自的評分狀態（`{ mine: {...} | null,
  other: {...} | null }`），給前端判斷「我還沒評 / 我已經評過 / 對方是否已評」。
- 匯總查詢：`src/lib/ratings.ts` 新增 `getUserRatingStats(userId)`（比照
  `getUserSharingStats` 的 `groupBy`／`aggregate` 風格）回傳 `{ avgStars, ratingCount }`。

**決策點與建議預設值**：
- **星等範圍**：建議 **1–5 整數**（業界慣例，OLIO/多數平台皆同），不做半星。
- **評語公開範圍**（涉誹謗風險，需注意但非本規格法律判斷）：建議**沿用 `ThanksMessage` 既有
  先例**——評語顯示在**該物品詳情頁**的交接完成區塊（新增 `rating-section.tsx`，比照
  `thanks-section.tsx` 並列），而不是彙整成一個「所有評語列表」攤在個人頁上；個人頁
  （`/u/[userId]`）與物品詳情頁物主資訊旁**只顯示彙總數字**（平均星等＋則數），不重複展示
  評語全文，降低單一頁面聚合大量文字評語的誹謗曝險。⚠️ **上線前若要公開展示評語全文，
  建議法務快速過一次**（審計報告未列入需律師項目，是本規格新增的注意提醒，非既有法務清單
  項目）。
- **雙盲揭露**（避免報復性評分：看到對方給你負評才故意也給負評）：建議**評語與星等在雙方都
  評完之前互相看不到對方的內容**（`GET .../ratings` 的 `other` 欄位在對方尚未提交時回
  `null`，即使自己已經提交也一樣），提交後才互相可見；**不設自動到期揭露 job**（沒有雙方都
  評分的交接就永遠不揭露，這是合理狀態、不需要額外機制強迫揭露）。
- **通知預設值**：`handover_rating_received`，`defaultInAppEnabled: true`、
  `defaultExternalEnabled: false`（比照 `completion_confirmed` 既有預設，非緊急事件）。
- **既有頁面整合點**：`src/app/(shell)/u/[userId]/page.tsx` 三格統計列（完成分享/完成接手/
  收到感謝）旁新增第四格「平均評分」；`src/app/(shell)/items/[id]/page.tsx` 物主資訊旁比照
  A3 既有信任訊號顯示 `★4.8（12 則評分）`（無評分時顯示「尚無評分」，不顯示 0 星誤導）。

**驗收要點**：雙方各自評分一次成功、第二次撞 unique 回 409；未完成交接評分回 409；
`stars` 超出 1–5 回 422；對方未評分前看不到內容、雙方都評完後互看得到；個人頁與物品詳情頁
平均星等數字正確（無評分顯示「尚無評分」而非 0）；評語過 `keyword_blocklist`。

---

### 2. 收藏 / 我的最愛（Favorites）

**定位**：使用者可收藏任何物品（不限狀態），`/me` 新增「我的收藏」清單；收藏物品被認領或即將
到期時收到提醒（審計 B3，呼應冷啟動期回訪率）。

**schema**：新表 `item_favorites`：
```
model ItemFavorite {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  itemId    String   @map("item_id")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  item Item @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@unique([userId, itemId])
  @@index([userId, createdAt])  -- /me/favorites 分頁
  @@index([itemId])             -- 反查「這個物品被幾人收藏」（社會證明數字＋通知扇出查詢）
  @@map("item_favorites")
}
```
`Item` 加 `favorites ItemFavorite[]`；`User` 加 `favorites ItemFavorite[]`。

**API**：
- `POST /api/items/[id]/favorites`：建立收藏。撞 unique（已收藏過）視為成功（200，不視為錯誤，
  冪等）。物品不存在回 404；不檢查物品狀態（可以收藏已下架/已完成的物品，純書籤性質）。
- `DELETE /api/items/[id]/favorites`：取消收藏，找不到收藏紀錄也回 200（冪等，比照
  M6 `web-push` 訂閱刪除的既定寬鬆風格）。
- `GET /api/me/favorites?cursor=...`：分頁列表，回傳格式沿用 `src/lib/items.ts` 的
  `ListedItem` 形狀（含 `status` 讓前端顯示「已完成/已下架」徽章），額外帶 `favoritedAt`。
- 物品詳情頁 server component 直接查一次 `db.itemFavorite.findUnique` 判斷目前使用者是否已收藏
  （不需要額外 API），並查 `db.itemFavorite.count({ where: { itemId } })` 顯示「已有 N 人收藏」
  社會證明數字（呼應 §11.8「未來功能參考」第 1 項既有構想）。

**通知掛接**（審計 B3 明確要求「收藏的物品被認領/即將到期」提醒）：
- **物品被認領/接受時**：在既有的三個「物品狀態離開 `published`」原子分支各自加一段扇出通知
  （`claims` 接受 transaction、`direct-shares` 接受 transaction、`lottery` confirm
  transaction）——對 `db.itemFavorite.findMany({ where: { itemId, userId: { not: <得標者/物主
  以外的收藏者} } })` 逐一 `createPreferenceGatedNotification`，`payload.kind:
  "favorite_item_claimed"`。**排除物主自己與最終得標者**（他們各自已經有 `claim_accepted`
  等既有通知，不必重複收到「你收藏的物品被認領了」）。
- **即將到期提醒**：`item-expiration` job 的 `processReminders` 分支，除了既有通知物主之外，
  額外對該物品的收藏者也發一則 `favorite_item_expiring`（同一批次查詢，不新增 job）。
- 新增 `NOTIFICATION_EVENT_TYPES` 目錄項目 `favorite_item_update`（涵蓋
  `favorite_item_claimed`／`favorite_item_expiring` 兩種 kind），
  `defaultInAppEnabled: true`、`defaultExternalEnabled: false`。

**決策點與建議預設值**：
- **收藏對物主是否可見「誰收藏了」**：建議**只顯示彙總數字，不顯示收藏者名單**（避免使用者
  感覺被陌生人「監視」，比照多數市集類產品做法）。
- **收藏數是否計入 rate limit**：建議**新增獨立 rate limit action `favorite_create`**
  （`hourly: 60, daily: 300`，比照 `message_create` 量級，防洗版但不擾民），沿用
  `src/lib/rate-limit.ts` 既有模式（`db.itemFavorite.count` 當 counter）。
- **/me 入口**：`src/app/(shell)/me/page.tsx` 的卡片清單新增「我的收藏」（`Heart` icon）
  → `/me/favorites`。

**驗收要點**：收藏/取消收藏皆冪等（重複呼叫不報錯）；`/me/favorites` 分頁正確、顯示物品目前
狀態；物品被認領後，除物主與得標者外的收藏者收到 `favorite_item_claimed` 通知；到期前 3 天
收藏者與物主都收到提醒；收藏數社會證明數字正確；`favorite_create` 超過 rate limit 回 429。

---

### 3. 封鎖使用者（Block User）

**定位**：使用者可主動封鎖騷擾對象，反應速度快於現有「檢舉→管理員審核」流程（審計 B2）。

**schema**：新表 `user_blocks`：
```
model UserBlock {
  id        String   @id @default(cuid())
  blockerId String   @map("blocker_id")
  blockedId String   @map("blocked_id")
  createdAt DateTime @default(now()) @map("created_at")

  blocker User @relation("UserBlockBlocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("UserBlockBlocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
  @@index([blockedId])  -- 供 isBlockedEitherDirection 反向查詢，以及未來申訴/客服需要時查「誰封鎖了這個人」
  @@map("user_blocks")
}
```
`User` 加 `blocksInitiated UserBlock[] @relation("UserBlockBlocker")`／
`blocksReceived UserBlock[] @relation("UserBlockBlocked")`。

**API**：
- `POST /api/users/[id]/block`：建立封鎖（不能封鎖自己，422）；撞 unique 視為成功（冪等）。
- `DELETE /api/users/[id]/block`：解除封鎖，找不到也回 200（冪等）。
- `GET /api/me/blocks`：我封鎖的名單（分頁），供 `/me/blocked-users` 管理頁使用。
- Helper `src/lib/user-blocks.ts` 匯出 `isBlockedEitherDirection(userA, userB): Promise<boolean>`
  （`OR: [{blockerId:A,blockedId:B},{blockerId:B,blockedId:A}]`，任一方向存在即視為封鎖）。

**⚠️ 核心決策點：封鎖是否讓對方無感知？** 建議**無感知（silent block）**，理由：
- 被封鎖方若被明確告知「你被這個人封鎖了」，容易升級成報復性騷擾（透過小帳、其他管道），
  多數同業（OLIO、Nextdoor 的封鎖/靜音功能）皆採無感知設計。
- **具體實作**：被擋下的操作一律回**通用錯誤訊息**，不透露「被封鎖」這個事實。例如留言被擋
  時回「目前無法對這個物品留言」而不是「你被物主封鎖了」（比照既有 `checkUserRestriction`
  的訊息風格但**不點名是封鎖**，因為那是使用者對使用者的私人選擇，不是平台裁罰，語意不同）。
- **例外**：`GET /api/me/blocks`（自己查自己封鎖了誰）與 `/me/blocked-users` 管理頁本身當然
  對封鎖發起人完全透明，無感知只針對「被封鎖的那一方」。

**執行範圍（scope guard，明確界定「封鎖」影響哪些既有查詢）**：
- **擋新的留言**：`POST /api/items/[id]/claims`——取得 `item.ownerId` 後呼叫
  `isBlockedEitherDirection(user.id, item.ownerId)`，任一方向封鎖過就擋（通用 403 訊息）。
- **擋新的直贈**：`POST /api/items/[id]/direct-shares`——物主選定 `receiverId` 時檢查雙向
  封鎖，擋下的話回通用錯誤（例如「無法直贈給這位使用者」，不解釋原因）。
- **不影響既有交接對話**：**刻意不**在 `POST /api/conversations/[id]/messages` 加封鎖檢查
  ——一旦 claim/direct-share 已經 accepted、雙方已經在交接中，代表這段配對在建立時就還沒有
  封鎖關係存在；封鎖是之後才發生的話，代表這段關係中途出狀況，**這種情況應該引導使用者用
  既有「檢舉」機制**（有管理員審核與稽核紀錄），而不是靜靜地讓一方消失在對話裡、對方卻不知道
  為什麼沒有回應——後者體驗更差、也規避了治理留痕。此為明確 scope guard，實作時不要因為
  「順手」就加上去。
- **不影響公開列表可見性**：物品列表/首頁瀏覽**不會**因為封鎖關係而互相隱藏對方的物品——
  公開列表本來就人人可見、且有 SEO／快取考量，per-viewer 過濾會破壞現有的
  `unstable_cache`／SSR 慣例，投報比不划算。真的想避開對方就別點進去、別留言。

**決策點與建議預設值**：
- **封鎖是否單向即生效，還是需要雙方都封鎖才生效**：建議**單向即生效**（`OR` 查詢任一方向）
  ——只要有一方封鎖，雙向的新互動都擋下，不需要對方也同意。
- **前端入口**：比照 `report-button.tsx` 慣例新增 `block-button.tsx`，放在對話串
  （`conversation-thread.tsx`）與物品詳情頁物主資訊旁；`/me/blocked-users`（列表＋解除封鎖）
  掛在 `/me/settings` 頁面裡的一個區塊連結過去（不佔用 `/me` 首頁卡片版位，這是低頻功能）。

**驗收要點**：封鎖後被封鎖方無法對封鎖方的物品留言/被直贈，錯誤訊息不透露封鎖存在；解除封鎖
後恢復正常；已在進行中的交接對話不受封鎖影響（可繼續私訊）；`/me/blocked-users` 可列表與解除；
不能封鎖自己（422）；封鎖/解除封鎖皆冪等。

---

### 4. 排行榜 opt-out

**定位**：使用者可選擇不出現在公開 `/leaderboard`，貢獻值照算、個人頁 `/u/[userId]` 照顯示
（審計未直接提及，使用者另外核准）。

**schema 決策：加在 `Profile`，不做 `NotificationPreference` 式的獨立表**。理由：這是單一
全站開關（不是「每種事件類型各自開關」的目錄式設定），`Profile` 本來就是「一個使用者一列，
放簡單設定值」的既有慣例（`nickname`／`cityId`／`bio` 皆是這種形狀），沒有理由為了一個布林值
另開一張表或沿用 `NotificationPreference` 的 key-value 模式（那是為了「多種事件類型」設計的，
這裡不是）。

```
model Profile {
  ...既有欄位...
  leaderboardOptOut Boolean @default(false) @map("leaderboard_opt_out")
  ...
}
```

**API**：擴充既有 `POST /api/profile`（`src/app/api/profile/route.ts`）：body 新增選填
`leaderboardOptOut?: boolean`，`upsert` 的 `update`/`create` 資料各自帶入
（沒帶這個欄位時維持既有值/預設 `false`，不強制每次都要傳）。

**決策點與建議預設值**：
- **預設值**：建議 **`false`（預設出現在排行榜）**——維持現有行為不變，migration 後所有既有
  使用者都不受影響，這是「加新開關」而非「改變預設行為」的最小驚訝原則。
- **`getLeaderboard()` 查詢調整**（`src/app/(shell)/leaderboard/page.tsx`）：在既有
  `db.user.findMany({ where: { id: {...}, deletedAt: null }, ... })` 加一條
  `profile: { leaderboardOptOut: false }`，被 opt-out 的使用者的貢獻值分數**仍然真實存在**於
  `contribution_events`（不做假的分數隱藏），只是不出現在這個 `groupBy` 結果被撈出來顯示。
- **前端入口**：`/me/settings` 頁面新增一個 checkbox「不出現在排行榜」（説明文案：「你的貢獻值
  依然照算，只是不會出現在公開排行榜上」），呼叫 `POST /api/profile`。

**驗收要點**：opt-out 後該使用者的貢獻值仍計入 `contribution_events`（分數不變），但
`/leaderboard` 撈不到他；`/u/[userId]` 個人頁**仍然**顯示他的貢獻值與統計（不受 opt-out
影響，只影響排行榜這一個頁面）；預設值為 `false`，既有使用者行為不變。

---

### 5. 面交約定時間（Meetup Scheduling）

**定位**：交接對話可設定約定面交時間，提前提醒降低 no-show 率（審計 B5）。

**schema**：擴充既有 `HandoverRecord`（不新建表——一筆交接只有一個約定時間，1:1 屬性，直接
加欄位比另開一張表更直接，比照 `CouponDetail`／`TicketDetail` 這類「掛在既有實體上的單一屬性」
的既定風格）：
```
model HandoverRecord {
  ...既有欄位...
  scheduledAt    DateTime? @map("scheduled_at")     -- 約定面交時間，任一方可設定/修改/清空
  reminderSentAt DateTime? @map("reminder_sent_at")  -- 提醒 job 的 idempotent 保護
  ...

  @@index([status, scheduledAt])  -- 提醒 job 掃描用（比照 items(status, expires_at) 既定風格）
}
```

**API**：`PATCH /api/handover/[id]/meetup`：body `{ scheduledAt: string | null }`
（ISO 8601；`null` 代表清空/取消約定）。
- 權限：物主或接手者皆可設定/修改/清空（後寫覆蓋，last-write-wins，不需要雙方確認——這是
  輔助性的提醒工具，不是交接的强制關卡，見下方決策點）。
- 前置條件：僅 `handover.status === "pending"` 時可修改（已完成/已標記未出現的交接沒有再約
  時間的意義，回 409）。
- 驗證：`scheduledAt` 若非 null，須為**未來時間**且**在 90 天內**（超出視為輸入錯誤，422，
  防呆用，非嚴格業務規則）。
- 若修改了已通知過的 `scheduledAt`（時間被改到提醒窗口之外或之內），**重設
  `reminderSentAt = null`**，讓提醒 job 依新時間重新判斷是否要提醒（避免使用者改時間後，
  舊的「已提醒」標記讓新時間點永遠不會被提醒）。

**提醒 job**：`POST /api/jobs/handover-meetup-reminder`（沿用既有 `CRON_SECRET`／
`system_jobs`／`system_job_runs` 模式，比照 `item-expiration` job 寫法）：
- 掃描 `status = 'pending' AND scheduledAt IS NOT NULL AND reminderSentAt IS NULL AND
  scheduledAt <= now() + 2 hours AND scheduledAt > now()`，用條件式 `updateMany`
  （`WHERE reminderSentAt IS NULL AND ...`）當樂觀鎖設定 `reminderSentAt = now()`，
  `count === 1` 才真的發通知（同一既定 idempotent 模式）。
- 通知物主與接手者雙方：`handover_meetup_reminder`，`payload.kind:
  "handover_meetup_reminder"`，內容含約定時間。

**決策點與建議預設值**：
- **是否需要雙方確認約定時間**：建議**不需要**——任一方設定/修改後對方就看得到最新值，這是
  低風險的輔助工具（不像抽籤/交接完成那樣需要嚴謹的雙方確認狀態機），簡化實作與 UX；若之後
  發現有人惡意亂改時間騷擾對方，可再靠既有「檢舉」機制處理，不需要一開始就做確認流程。
- **提前提醒時間**：建議 **2 小時前**（研究來源 4 的 Cal.com 部落格泛用結論：事前提醒本身就
  能顯著降低 no-show；2 小時是常見面交場景的合理提前量，太早使用者可能忘記，太晚來不及調整
  行程）。此數值集中放在 job 檔案的常數，之後可調整。
- **外部 cron 觸發頻率**：由 Zeabur 排程設定決定（建議每 15–30 分鐘觸發一次以達到「提前 2
  小時」的準確度），job 本身透過 `reminderSentAt` 保證重複觸發不重複通知，觸發頻率是純營運
  設定、非本規格需要鎖死的數字。
- **通知預設值**：`handover_meetup_reminder`，`defaultInAppEnabled: true`、
  **`defaultExternalEnabled: true`**（比照 `claim_accepted`／`handover_message` 這類時效性高
  的既有事件，外部通知預設開，因為這正是「降低 no-show」這個目標最需要觸及使用者的管道）。
- **前端整合點（呼應審計 A1）**：`handover-section.tsx` 新增「約定面交時間」小工具（日期時間
  選擇器＋顯示目前約定值＋編輯按鈕），**緊鄰**放置審計 A1 建議的面交安全提示文案（若 A1 尚未
  另外落地，本交付應順手把這段文案一併加上，兩者本來就該出現在同一個操作節點）。

**驗收要點**：任一方設定約定時間後對方看得到；修改時間後 `reminderSentAt` 重置；到期提醒窗口
到達時雙方收到通知；已完成/no_show 的交接無法再修改約定時間（409）；job 重複觸發不重複通知
（idempotent）；時間驗證擋過去時間與超過 90 天的輸入。

---

### 6. 產品成長儀表板（無 schema）

**定位**：`/admin/ops` 風格的新後台頁，顯示**產品指標**（非工程指標）：D7/D30 回訪率、
上架→成交轉換率、成交中位時間。

**頁面**：`/admin/growth`（moderator/admin 限定，其餘 404，比照 `require-ops-access.ts`
寫法新增 `src/app/admin/growth/require-growth-access.ts`，reuse `isModeratorOrAdmin`
from `src/lib/support-tickets.ts`）；`admin-nav.tsx` 新增
`{ href: "/admin/growth", label: "成長指標" }` 入口。純 server component 直接查 db（比照
`/admin/ops` overview 頁的既定寫法，不透過中介 API route），三個指標各自一個卡片區塊
（比照 ops overview 頁的三卡片佈局），依 dataviz 技能慣例做基本圖表化（建議先做數字卡片＋
簡單趨勢線，避免一次做太複雜的圖表）。

**指標定義**（新增 `src/lib/growth-metrics.ts` 集中查詢邏輯）：

1. **D7 / D30 回訪率**：
   - **⚠️ 已知限制（口徑說明，非法規/安全問題）**：ShareGood 沒有 page-view/session 級的
     使用者行為追蹤表，無法定義「單純瀏覽」也算回訪。這裡的「回訪」定義為**「註冊 N 天後的
     窗口內，該使用者名下產生至少一筆下列任一動作型資料表的新紀錄：`Item`（上架）、
     `ClaimComment`（留言/認領）、`DirectShare`（收到並回應直贈，以 `respondedAt` 判斷）、
     `Message`（發送私訊）、`ContributionEvent`（完成分享/接手）」**——即「有實際互動」才算
     回訪，比純頁面瀏覽更嚴格但更能反映真實參與度。之後若要做更精確的版本，需要新增
     page-view 事件表，**不在本次範圍**。
   - **計算方式**：cohort = `Profile.createdAt` 落在 `[today − (N+7), today − N]`
     區間的使用者（確保他們的第 N 天窗口已經完整走完）；分子 = cohort 中，上述 5 張表任一張
     有 `userId` 相符且 `createdAt` 落在 `[signupDate, signupDate + N days]` 的使用者數
     （去重後的 distinct userId 數）；分母 = cohort 大小。D7 用 N=7、D30 用 N=30，兩者各自
     獨立計算。
   - 現有索引（`contribution_events(user_id, created_at)`、`claim_comments` 的
     `userId` 索引等）在目前平台規模已足夠這種低頻的 admin 診斷查詢，**不需要新增索引**。

2. **上架→成交轉換率**：分母 = 過去 N 天內 `publishedAt` 落在窗口內、且**已經到達終態**
   （`status IN (completed, expired, removed_by_user, removed_by_moderator)`）的物品數
   （**刻意排除**仍在 `published`／`reserved`／`handover_pending` 的物品——它們的命運還沒
   確定，算進分母會低估轉換率）；分子 = 其中 `status = completed` 的數量。視窗建議預設 30 天，
   可用 query param 調整（例如 `?days=30`）。

3. **成交中位時間**：對 `status = 'completed'` 且 `publishedAt` 落在視窗內的物品，計算
   `HandoverRecord.completedAt − Item.publishedAt` 的中位數，用 PostgreSQL
   `percentile_cont(0.5) WITHIN GROUP`（比照 `src/app/api/admin/ops/performance/route.ts`
   的既定 `$queryRaw` 寫法，本章沿用同一手法，僅換成對 `items` JOIN `handover_records` 的
   時間差聚合）：
   ```sql
   SELECT percentile_cont(0.5) WITHIN GROUP (
     ORDER BY EXTRACT(EPOCH FROM (hr.completed_at - i.published_at))
   ) AS median_seconds
   FROM items i JOIN handover_records hr ON hr.item_id = i.id
   WHERE i.status = 'completed' AND i.published_at >= $windowStart
   ```

**驗收要點**：`/admin/growth` 對非 moderator/admin 回 404；三個指標數字用手算的假資料驗證
（例如手動建立已知 cohort 大小與活躍數，驗證回訪率百分比計算正確）；轉換率分母正確排除
未到終態物品；中位數計算與手算樣本一致；`admin-nav.tsx` 有入口。

---

### 7. 供給側批量上架（無 schema）

**定位**：`/items/new` 的「一次建立多筆相似物品」捷徑，服務冷啟動期團隊/親友大量上架
（master-plan 「冷啟動與宣傳建議」第 1 項：上線初期由團隊手動上架 20–50 件真實物品）。

**scope guard（明確排除）**：批量模式**僅適用一般物品**，不支援優惠券／即期食品／票券／點數
四種需要複雜子欄位（券碼加密、到期日、法定警示確認勾選等）的分類——這些每筆的專屬欄位
（券碼、點數平台、原始票券平台）天生就不容易「相似批量」，硬做只會讓表單更複雜、驗證邏輯
更難維護。使用者若選到這四種分類之一，批量表單顯示提示「此分類請個別上架」並停用「繼續」。

**API**：`POST /api/items/batch`：
```
{
  categoryId: string,
  cityId: string,
  items: [
    { title: string, description: string, images: [{thumbObjectId, mediumObjectId}, ...] },
    ... 最多 10 筆
  ]
}
```
- 權限：`requireUser()`＋`profile` 存在檢查＋`checkUserRestriction(user.id, "posting")`
  （與既有 `POST /api/items` 完全相同的前置檢查，直接沿用）。
- **驗證階段全部先跑完、任何一筆不合格就整批 422 拒絕**（回傳
  `{ error: { code: "UNPROCESSABLE", message: "...", details: [{ index, message }, ...] } }`，
  `details` 是既有 `jsonError` 形狀的擴充，非破壞性變更）——**不做部分成功**（不會出現「10 筆
  裡只成功建立 6 筆」的曖昧狀態），使用者修正錯誤後整批重新送出。
  - `categoryId`／`cityId` 有效性檢查（同既有邏輯）；`category.slug` 不得屬於券/食品/票/點
    四種特殊分類（見上方 scope guard）。
  - `items.length` 須為 1–10（建議前端 UI 引導至少 2 筆才顯示批量表單，但 API 本身不擋 1 筆，
    保持寬鬆）。
  - 每筆各自驗證 `title`（2–60 字）、`description`（1–1000 字）、`images`（1–5 張，格式同
    既有 `parseImages`）、`keyword_blocklist`（標題＋描述）。
  - **實作建議（避免重複程式碼）**：把 `POST /api/items` 裡 `title`／`description`／
    `images`／`keyword_blocklist` 這段驗證邏輯抽成共用函式（例如
    `src/lib/item-validation.ts` 的 `validateBasicItemFields()`），批量端點與既有單筆端點
    共用，不要複製貼上第二份。
- 通過驗證後，**整批包在同一個 `$transaction`**：對每一筆依序做「claim images（既有
  `StorageObject` 的 `uploaderId`＋`status=pending→linked` 原子 `updateMany` 搶用防呆，
  沿用既有 `POST /api/items` 機制）」＋`item.create`（`status` 依 `REQUIRE_REVIEW` feature
  flag 決定 `published` 或 `pending_review`，同既有邏輯）＋`itemStatusLog.create`。全部成功
  才 commit，任何一筆意外失敗（例如圖片被搶用）整批回滾——**批量的原子性圖片搶用失敗機率
  應該極低**（使用者自己剛上傳的圖片，不會被別人搶），回滾是防呆而非常態路徑。
- 回傳 `201`，`{ items: [{ id, title }, ...] }`（依輸入順序）。

**Rate limit（決策點）**：既有 `item_create`（`hourly: 5, daily: 20`）對批量上架的目標場景
（一次貼 10 筆）太緊，會讓批量功能形同虛設。建議**新增獨立 action `item_create_batch`**
（`src/lib/rate-limit.ts`）：
```
item_create_batch: { hourly: 30, daily: 50 }
```
counter 沿用 `item_create` 相同的查詢（`db.item.count({ where: { ownerId, createdAt: {
gte: since } } })`——不管物品是透過單筆還是批量建立，都算進同一個 `items` 計數，批量端點只是
在**呼叫這個 action 時檢查一組較寬鬆的門檻**。效果：使用者能一口氣批量上架到 50 件/天，但
若當天已經用掉大部分批量額度，之後再打單筆 `POST /api/items`（門檔 `item_create` 的每日 20）
一樣會被既有較嚴格的門檻擋下——兩個門檻各自對各自的呼叫路徑生效，不互相放寬，這是刻意的
不對稱設計（批量入口给冷啟動場景更高的上限，單筆入口維持原本反洗版設定）。

**前端**：新頁面 `/items/new/batch`（不塞進既有 597 行的 `item-form.tsx`，維持該檔案單一
職責）：
1. 步驟一：選分類＋縣市（選到四種特殊分類會被擋，提示改用一般表單）。
2. 步驟二：可增減的列表列（每列：標題／分享的話／圖片上傳），建議 UI 上限制最少 2 列才顯示
   這個入口（低於 2 筆直接導去一般 `/items/new`），上限 10 列。
3. **實作建議（避免重複程式碼）**：`item-form.tsx` 現有的圖片上傳邏輯（`addImages`／
   `ImageSlot` 狀態機，約 50–100 行）應抽成共用元件/hook（例如
   `src/components/image-upload-grid.tsx` 或 `useImageUploadSlots` hook），批量頁面每一列
   各自一份實例，避免複製貼上整段上傳邏輯。
4. 全部列驗證通過才能送出；送出後整批呼叫 `POST /api/items/batch`，錯誤時依 `details` 的
   `index` 標示是哪一列有問題。

**驗收要點**：批量建立 3–10 筆成功，全部進資料庫且狀態依 `REQUIRE_REVIEW` 正確；任一筆標題
過短時整批不建立、回傳正確的 `details` 索引；選到券/食品/票/點分類時擋下；`item_create_batch`
門檻與 `item_create` 各自獨立生效（驗證兩者互不放寬對方）；圖片搶用沿用既有防呆機制。

---

## 合併後的單一 migration 地基清單

（比照 M9 PR #44 模式：schema 地基先一次到位，功能實作各自平行進行）

**新表（5 張）**：
- `handover_ratings`（交付內容 1）
- `item_favorites`（交付內容 2）
- `user_blocks`（交付內容 3）
- 無新表（交付內容 4／5 為既有表加欄位，見下）

**既有表加欄位（3 處）**：
- `profiles` 加 `leaderboard_opt_out boolean not null default false`（交付內容 4）
- `handover_records` 加 `scheduled_at timestamptz nullable`、
  `reminder_sent_at timestamptz nullable`（交付內容 5）

**新增索引清單**：
```
handover_ratings: unique(handover_record_id, rater_id)
handover_ratings(ratee_id, created_at)
item_favorites: unique(user_id, item_id)
item_favorites(user_id, created_at)
item_favorites(item_id)
user_blocks: unique(blocker_id, blocked_id)
user_blocks(blocked_id)
handover_records(status, scheduled_at)   -- 面交提醒 job 掃描用
```

**Prisma model 增修彙總**（供實作 session 對照，非最終程式碼）：
- `User` 新增關聯：`handoverRatingsGiven`／`handoverRatingsReceived`／`favorites`／
  `blocksInitiated`／`blocksReceived`。
- `Item` 新增關聯：`favorites`。
- `HandoverRecord` 新增欄位 `scheduledAt`／`reminderSentAt`，新增關聯 `ratings`。
- `Profile` 新增欄位 `leaderboardOptOut`。
- 新 model：`HandoverRating`、`ItemFavorite`、`UserBlock`。

**乾淨 DB 驗收**：`prisma migrate deploy && prisma db seed` 從零跑通；`prisma/seed.ts`
**本章不需要新增任何 seed 資料**（三張新表都是使用者行為產生的資料，沒有種子資料的必要，
`leaderboard_opt_out`／`scheduled_at`／`reminder_sent_at` 皆有預設值或允許 null，不影響既有
seed 邏輯）。

---

## 實作分工建議

**依賴關係圖**：
```
schema 地基（本章全部 migration 一次做完，含上表 3 張新表＋3 處欄位）
   │
   ├─→ 交付 1 雙向互評（獨立，僅依賴 HandoverRecord 既有 completed 狀態）
   ├─→ 交付 2 收藏（獨立，但通知扇出需要碰 claims/direct-shares/lottery 三支既有 accept
   │            transaction＋item-expiration job，屬「小改動既有檔案」而非新建，建議由
   │            同一個 wave 做完，避免三個 agent 同時改同一批檔案互相衝突）
   ├─→ 交付 3 封鎖使用者（獨立，但需要碰 claims／direct-shares 兩支既有 API 加檢查，同上
   │            建議與交付 2 同一批次做、且避開同時改到 claims/direct-shares 的另一個 wave）
   ├─→ 交付 4 排行榜 opt-out（獨立，最小工作量，可任意時段插入）
   ├─→ 交付 5 面交約定時間（獨立，新增一支 job＋一支 API＋前端小工具）
   ├─→ 交付 6 產品成長儀表板（完全獨立，純查詢，不碰任何既有 mutation 檔案，可最先做
   │            或最後做都無妨，適合單獨一個 agent 全程處理不必等其他交付完成）
   └─→ 交付 7 供給側批量上架（完全獨立，新檔案為主，唯一風險是「建議抽共用驗證函式」若要
                真的落實，需要碰一次既有 POST /api/items/route.ts 做重構，建議排在交付 2/3
                的「碰 claims 相關檔案」wave 之外，避免同時有三個 agent 改動 items 相關路由）
```

**建議分工（3 個平行 wave，避免同時有多個 agent 改動同一批既有檔案造成合併衝突）**：
1. **Wave A（純新增，可完全平行）**：交付 4（排行榜 opt-out）＋交付 6（產品成長儀表板）＋
   交付 1（雙向互評，只碰 `handover-section.tsx`／新增 `rating-section.tsx`，與其他 wave
   不重疊）。三者互不觸碰同一個既有檔案，可以三個 agent 同時做。
2. **Wave B（觸碰 claims/direct-shares/lottery 既有 accept transaction 與 item-expiration
   job）**：交付 2（收藏通知扇出）＋交付 3（封鎖檢查）**建議合併成一個 wave 由同一個 agent
   循序處理**，因為兩者都要在 `claims/route.ts`／`direct-shares/route.ts` 加檢查/通知邏輯，
   同時派兩個 agent 改同一批檔案風險高於效益。
3. **Wave C（新增為主，小幅重構既有驗證邏輯）**：交付 5（面交提醒）＋交付 7（批量上架）。
   若交付 7 決定要把 `POST /api/items` 的驗證邏輯抽成共用函式，這個重構動作應與交付 7
   同一個 agent 做完（不要另外派一個「重構」agent，避免與交付 7 的實作產生時間差衝突）。

**跨 wave 共用前置**：Prisma schema migration（3 張新表＋3 處既有表加欄位）必須先合併進
`main`，三個 wave 才能各自基於同一份 schema 開工——比照 M9 「schema 地基→平行功能」的既定
節奏，migration 本身作為獨立第一個 PR 先行 merge。

---

## 核心表變更的相容性風險

**`Item` 表**：僅新增一個反向關聯 `favorites ItemFavorite[]`（Prisma 關聯欄位，**不產生實際
資料庫欄位**，零 migration 風險）。既有 `items(status, city_id, category_id, created_at)`
等索引與所有既有查詢完全不受影響。批量上架（交付 7）呼叫既有的 `item.create` 邏輯 N 次，
不改變單筆建立路徑的任何行為——**唯一需要注意**：若實作決定把驗證邏輯抽成共用函式（建議做法），
重構 `POST /api/items/route.ts` 時務必用既有測試（`e2e/integration/*.test.ts` 涵蓋上架相關
案例）跑一次回歸，確保重構沒有改變既有驗證行為（例如錯誤訊息文字、欄位長度上限）。

**`User` 表**：新增 5 個反向關聯欄位（`handoverRatingsGiven`／`handoverRatingsReceived`／
`favorites`／`blocksInitiated`／`blocksReceived`），同樣是 Prisma 關聯層級、**不產生實際
資料庫欄位**。`User` 表本身的實體欄位（`id`／`email`／`deletedAt` 等）完全不變，M7 帳號刪除
去識別化（`deletedAt` 判斷）與 M2 角色檢查等既有邏輯不受影響。**需要注意**：M7 帳號刪除去
識別化執行時（`account-deletion.ts`），新的三張使用者行為表（`handover_ratings`／
`item_favorites`／`user_blocks`）**應該檢視是否需要納入去識別化範圍**——目前規格未涵蓋這點，
若 M7 的去識別化邏輯是走「掃描特定表清單」的方式（而非依 `onDelete: Cascade` 全部清除），
本章三張新表需要在 `docs/plan/master-plan.md` §7a 的資料清單裡補登記，否則已去識別化帳號的
評分/收藏/封鎖紀錄可能殘留使用者可識別資訊。**這是本規格的已知缺口，建議實作 session 開工
前先讀一次 `src/lib/account-deletion.ts` 確認去識別化的實際機制，再決定是否需要為這三張表
補一段去識別化處理**。

**`HandoverRecord` 表**：新增 `scheduledAt`／`reminderSentAt` 兩個 nullable 欄位＋一個新索引
`(status, scheduledAt)`。`itemId @unique` 等既有欄位與約束不變；既有的
`POST /api/items/[id]/handover/ensure`（懶建立）、`PATCH /api/handover/[id]/complete`、
`PATCH /api/handover/[id]/no-show` 三支既有 API **完全不需要修改**（它們不觸碰這兩個新欄位，
新欄位預設 `null`，既有的 `upsert`／`updateMany` 條件式寫入不受影響）。新索引是純新增，不影響
既有查詢計劃（PostgreSQL 不會因為多了一個索引就改變既有查詢的執行計劃選擇，除非查詢本身
命中新索引涵蓋的欄位）。

**`Profile` 表**：新增 `leaderboardOptOut` 一個 `NOT NULL DEFAULT false` 欄位——對既有資料列
是安全的 migration（Postgres 加有預設值的 `NOT NULL` 欄位不需要鎖表重寫，現代 Postgres 版本
可以快速套用預設值中繼資料，不逐列更新）。既有 `POST /api/profile`、onboarding 表單完全不受
影響（新欄位選填，不影響既有必填欄位驗證）。

---

## 不做（scope guard；各附一句理由）

- **不做 C1 綜合信任分數/徽章等級**：本章的互評/收藏/封鎖是「拼圖」，真正合成單一信任分數
  需要更多資料累積與產品判斷，非本章範圍（比照 M9 對 C 級長期方向的既定處理）。
- **不做評分的雙方確認/申訴流程**：評分本身不是治理裁罰，若評分內容不當（辱罵、人身攻擊），
  引導使用者走既有「檢舉」機制處理（檢舉三選一目前是物品/留言/私訊，**若要涵蓋評分內容，
  需要在 M2 `Report` 的可為 null 外鍵組合裡新增 `handoverRatingId`，這是後續才要做的擴充，
  不在本章範圍**，暫時的因應是評分內容一樣受既有 `keyword_blocklist` 攔截）。
- **不做封鎖名單的批次匯入/匯出**：使用者一個一個手動封鎖已經足夠低頻，不需要批次操作。
- **不做批量上架的批次編輯/批次下架**：本章批量僅涵蓋「建立」這個冷啟動痛點，批次管理既有
  物品（例如一次下架 10 件）是不同的使用情境，非本章範圍。
- **不做面交約定時間的行事曆整合**（例如產生 .ics 檔案讓使用者加進 Google 日曆）：這是錦上添花
  的便利功能，非降低 no-show 的核心機制（提醒通知本身才是核心），可留待之後有需求再評估。
- **不做產品成長儀表板的匯出/排程報表 email**：`/admin/ops` 現有慣例也是純網頁查詢、無匯出，
  本章比照維持一致，不擴大範圍。

---

## 需律師審閱項目彙總（上線前必答，僅本章新增項目）

> 沿用 M7/M9 慣例：法律相關段落上線前需**台灣執業律師**審閱，模型無法替代。

1. **（交付內容 1，雙向互評）評語公開展示的誹謗風險邊界**：本規格建議把評語限定顯示在物品
   詳情頁（比照既有 `ThanksMessage` 先例）、個人頁只顯示彙總數字以降低曝險，但「使用者留下
   不實負評導致對方名譽受損」的責任歸屬（平台是否需要 notice-and-takedown 機制）未經法律
   意見確認，建議上線前律師快速過一次（此為本規格新增的注意提醒，非既有 M7/M9 法務清單
   項目的延伸）。

（本章其餘六項功能皆不涉及新的法律風險面向——封鎖/收藏/opt-out/面交提醒/成長儀表板/批量上架
皆為既有機制的功能性延伸，不新增涉及金流、個資揭露、內容侵權等既有法務清單已覆蓋範圍之外的
風險。）

---

## 驗收清單（總覽，各交付內容細項見上方各節）

- [ ] 乾淨 DB `prisma migrate deploy` 後 `handover_ratings`／`item_favorites`／`user_blocks`
      三張新表存在；`profiles.leaderboard_opt_out`／`handover_records.scheduled_at`／
      `handover_records.reminder_sent_at` 三個新欄位存在；上表列出的所有新索引皆已建立。
- [ ] 交付 1–7 各自的驗收要點（見各節）逐條通過。
- [ ] `NOTIFICATION_EVENT_TYPES` 目錄新增 `favorite_item_update`／`handover_meetup_reminder`／
      `handover_rating_received` 三項，`/me/notification-preferences` 可個別開關。
- [ ] `admin-nav.tsx` 新增 `/admin/growth` 入口；`/me` 新增「我的收藏」卡片；`/me/settings`
      新增排行榜 opt-out 開關與封鎖名單管理入口。
- [ ] 核心表變更相容性：既有 M1–M9 整合測試套件（`e2e/integration/*.test.ts`）與 Playwright
      主迴路 E2E（`e2e/tests/main-loop.spec.ts`）全部維持通過，證明本章新增欄位/索引未破壞
      任何既有查詢或流程。
- [ ] `npx biome check .`／`npx tsc --noEmit`／`NODE_ENV=production npx next build` 全過。
- [ ] `docs/governance/judgment-rubrics.md` §5 三組底線逐條過（比照 M1/M9 既定驗收慣例）。
- [ ] read-back 全章：無任何法務判斷被寫死成確定結論（互評公開範圍已標注「建議」而非法律
      定論）、無封鎖功能讓被封鎖方能推斷出「被封鎖」這個事實的錯誤訊息、無排行榜 opt-out
      影響個人頁顯示的誤植、無面交約定時間變成強制關卡（單方即可設定/修改的設計未被誤改成
      需要雙方確認）。
