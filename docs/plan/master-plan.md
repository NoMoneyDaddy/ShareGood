# ShareGood 主控規格（Master Plan v2）

> **本文件是唯一主控規格。** `original-master-plan-v1.md` 是歷史備份，僅供考古，不要照它執行。
> 讀法：開工前讀 §1–§3（定位與通用慣例），然後讀**你目前 milestone 的那一節**，並查 §11 附錄中
> 屬於該 milestone 的條目（資料表、索引、併發保護）。除此之外不要試圖一次讀完全文。
> v2 相對 v1 的差異：全部決策保留，但重排成可逐 milestone 執行的格式；MVP 砍線重排（理由見 §4）；
> 補齊 v1 缺的慣例（命名、環境變數、錯誤格式、seed 規格、每階段驗收）。

---

## 1. 產品定位（一段話版）

台灣縣市級**免費共享平台**：把用不到但還能用的好物分享出去，讓剛好需要的人接手。
主迴路：**上架 → 留言需要 → 分享者選人（或直贈）→ 私訊交接 → 完成共享 → 感謝與貢獻值**。

**永遠不做（non-goals，任何 session 不得擅自加回）：**
- 金流（付款、補差價、押金、運費補貼——一律禁止且屬違規行為）
- 物流（平台不介入交付，雙方自行約定）
- 交換／以物易物
- 社區圈／鄰里群組（最細到縣市）
- 收集敏感個資：真名、電話、地址、GPS、身分證、生日（V1 一律不收）

## 2. 技術棧（已定案，改動需使用者同意）

| 層 | 選型 |
|---|---|
| 全端框架 | Next.js（App Router）monolith，TypeScript strict |
| DB | PostgreSQL + Prisma |
| 物件儲存 | MinIO（S3 相容），圖片一律走這裡，DB 只存 object key |
| 認證 | Auth.js：Google OAuth 先做，LINE 後補 |
| UI | Tailwind CSS + shadcn/ui |
| 背景工作 | PostgreSQL job table + Next.js route 觸發起步；Redis/Worker 是 V2 之後的擴充 |
| 部署 | GitHub → Zeabur CI/CD；服務：`sharegood-web` / `sharegood-postgres` / `sharegood-minio` |
| 通知 | 站內通知先做；Telegram → Web Push 依序後補 |

Zeabur Free Plan 用於開發與 demo；正式上線前升級方案（詳見 §12 上線前檢查）。

## 3. 通用慣例（每個寫程式碼的 session 都必須遵守）

### 3.1 命名
- DB 表名：`snake_case` 複數（`claim_comments`）；Prisma model：PascalCase 單數（`ClaimComment`）。
- API route：`app/api/<resource>/route.ts`，RESTful；資源用複數（`/api/items/[id]/claims`）。
- 前台頁面路徑照 §10 頁面地圖，不自創。

### 3.2 API 慣例
- 回應格式：成功直接回資料；失敗回 `{ "error": { "code": "FORBIDDEN", "message": "…" } }`，
  HTTP status 與 code 一致（400/401/403/404/409/422/429/500）。
- **所有 mutation 必須 server-side 權限檢查**（session → role → resource ownership），前端的隱藏按鈕不算防護。
- 所有列表 API 必分頁：cursor-based，預設 20 筆，上限 50；禁止 `SELECT *`（Prisma select 明確欄位）。
- 寫入去重靠 DB constraint（unique / transaction），不靠前端防連點。

### 3.3 圖片管線（M0 就建好，之後所有上傳走同一條）
```
上傳 → 驗 magic bytes → 檢查大小(≤5MB) → 去 EXIF → 壓縮 → 產 thumb(320px)/medium(768px)
→ 上傳 MinIO → DB 存 object key。原圖預設不保留。
```
- 格式僅 jpg/png/webp；每物品最多 5 張；檢舉/申訴/回報附件各最多 3 張。
- 目標大小：medium 300–500KB、thumb 50–120KB。

### 3.4 環境變數（單一清單，新增變數必須回寫這裡）
```
DATABASE_URL            # PostgreSQL 連線字串
NEXTAUTH_URL            # 站台 URL
NEXTAUTH_SECRET         # Auth.js session 加密
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET   # MinIO
S3_PUBLIC_URL           # 圖片對外讀取的 base URL
COUPON_SECRET_KEY       # M3 起：券碼加密（AES-256-GCM）
TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET              # M4 起
CRON_SECRET             # 保護 job 觸發 route
```
- secrets 只放環境變數；repo 內放 `.env.example`（只有 key 沒有值）。

### 3.5 測試與驗收慣例
- 每個 milestone 完成的定義：該節「驗收清單」逐條有證據＋`docs/governance/judgment-rubrics.md` §5
  三組底線全過，缺一不算完成。
- 測試框架：Vitest（單元/整合）＋ Playwright（E2E，M1 起每個主迴路一條）。
- migration 必須能在乾淨 DB 從零跑通：`prisma migrate deploy && prisma db seed`。

### 3.6 前端設計品質（impeccable skill）

- 專案採用 [impeccable](https://github.com/pbakaus/impeccable) 設計技能（使用者指定）。
  M0 時以 `npx impeccable install` 安裝進專案 `.claude/` 目錄並 commit。
- 用法：開工新頁面前可跑 `/impeccable init` 建立設計上下文；每個前端頁面完成後跑
  `/impeccable audit`（技術品質）與 `/impeccable critique`（UX 評審），重大問題修完才算該頁完成；
  上線前對關鍵頁跑 `/impeccable polish`。
- 設計取捨仍屬品味判斷（judgment-rubrics §6）：skill 的建議與使用者偏好衝突時，聽使用者的。

### 3.7 Git
- 分支：`main` 為主；功能開 `feature/*`、修復 `fix/*`。
- Commit 前綴：`feat: / fix: / perf: / sec: / docs: / test: / chore:`。
- 每完成一個可交付單位立即 commit；一個 session 只做一個 milestone 的工作。

---

## 4. Milestone 總覽與砍線理由

v1 的 Phase 1–11 重排為以下 milestones。**排序原則：先跑通主迴路讓真人能試用，判斷密集與
高複雜度功能後移。** 每項後移都附理由，使用者可否決改回。

| Milestone | 內容 | 對應 v1 Phase | 版號 |
|---|---|---|---|
| M0 | Foundation：scaffold、Auth、DB、MinIO 圖片管線 | 1＋2 | v0.1 |
| M1 | 核心共享主迴路：上架→留言→直贈→交接私訊→完成→感謝/貢獻值 | 3＋4＋9 的私訊部分 | v0.2–0.4 |
| M2 | 治理底線：檢舉、強制下架、功能限制、admin 後台最小集 | 5 | v0.5 |
| M3 | 到期與優惠券：自動下架 job、券碼加密與錢包、即期提醒 | 6 | v0.6 |
| M4 | 通知強化：偏好設定、Telegram、每日摘要 | 7 | v0.7 |
| **← 公開試用砍線**：M0–M4 完成即可小規模公開試用（搭配 §12 上線前檢查） | | | v1.0 |
| M5 | 抽籤 | 9 | v1.1 |
| M6 | 訂閱通知（關鍵字/類別/縣市）＋ Web Push | 8 | v1.2 |
| M7 | 資料權利與法務：匯出/刪除、retention、legal hold | 10 | v1.3 |
| M8 | 營運強化：效能儀表板、備份演練、storage 監控後台 | 11 | v1.4 |

**主要砍線決策與理由：**
1. **抽籤後移到 M5**（v1 放 Phase 9 但屬 MVP 氛圍）：抽籤是三種選人方式中複雜度最高的
   （狀態機 9 態、遞補、防重複、公平性稽核），而「留言＋分享者挑人」與「直贈」已覆蓋 90% 場景。
2. **審核制改為「先發後審」**：v1 要求上架先過 `pending_review`。冷啟動期物品量少、人力只有站長一人，
   事前審核會扼殺供給。MVP 改為發布即公開＋事後強制下架（M2）＋關鍵字黑名單自動攔截。
   `pending_review` 狀態保留在 schema，用 feature flag `REQUIRE_REVIEW` 切換，之後隨時可開。
3. **Telegram 先於 Web Push**：兩者都做是重工。Telegram Bot 實作簡單、可靠、台灣使用率可接受；
   Web Push 的 service worker 與跨瀏覽器相容成本高，移到 M6。
4. **訂閱通知（v1 Phase 8）移到公開試用之後**：回訪機制在使用者基數為零時無意義，先有物再談訂閱。
5. **法務/警方模組（v1 Phase 10 的 legal request/hold）移到 M7**：上線初期用「手動流程＋不刪資料」
   頂住即可；但 §12 要求上線前先有條款頁與隱私政策頁（靜態頁，成本低）。
6. **私訊提前進 M1**：v1 把私訊放 Phase 9，但主迴路的「交接」沒有私訊就走不通。M1 做最小版：
   交接成立後自動開一個綁定該物品的雙人對話，polling 更新、無已讀回條、無 realtime。

---

## 5. M0 — Foundation（v0.1）

**目標**：一個可部署到 Zeabur、能登入、能上傳圖片的空殼。
**依賴**：無（repo 目前是空的）。

### 交付內容
1. Next.js（App Router、TypeScript strict）＋ Tailwind ＋ shadcn/ui scaffold。
2. Prisma + PostgreSQL 接通；初始 migration。
3. Auth.js + Google OAuth；登入後強制設定暱稱與縣市（onboarding）。
4. 資料表：`users`、`accounts`、`sessions`、`profiles`、`user_roles`、`audit_logs`、
   `categories`、`cities`、`storage_objects`。
5. RBAC 基礎：角色 `user` / `moderator` / `admin`；權限檢查 helper（`requireUser()` /
   `requireRole()`），所有後續 API 都用它。
6. MinIO 接通＋ §3.3 圖片管線（上傳 API＋壓縮＋縮圖）＋孤兒檔清理 job（每日）。
7. Seed：台灣 22 縣市（`cities`）、初始分類（`categories`：食品雜貨/優惠票券/居家生活/服飾配件/
   母嬰童書/3C 家電/文具玩具/寵物用品/其他）、admin 帳號綁定站長 email。
8. 部署到 Zeabur 三服務並跑通。
9. 安裝 impeccable 設計技能（見 §3.6）：`npx impeccable install` 裝進專案 `.claude/` 並 commit。

### 不做（scope guard）
- 不做任何物品/留言功能；不做 LINE OAuth；不做 rate limit（M2）；不做 email。

### 驗收清單
- [ ] 乾淨 DB 跑 `prisma migrate deploy && prisma db seed` 成功，22 縣市與分類齊全。
- [ ] Google 登入 → onboarding 設暱稱縣市 → 首頁顯示登入狀態，全程實跑通過。
- [ ] 上傳一張 3MB jpg：MinIO 出現 thumb/medium 兩檔、原圖不存在、EXIF 已去除、DB 有 object key。
- [ ] 上傳一個改副檔名的 .exe → 被 magic bytes 檢查擋下（422）。
- [ ] 非 admin 帳號打 admin-only 測試端點 → 403。
- [ ] Zeabur 上以正式環境變數部署成功，健康檢查 route `/api/health` 回 200。
- [ ] `.claude/` 內有 impeccable skill，`/impeccable` 指令可用。

---

## 6. M1 — 核心共享主迴路（v0.2–v0.4）

**目標**：兩個真人可以完整走完「分享→接手→完成」，這是整個產品的存在理由。
**依賴**：M0。

### 交付內容
1. 資料表：`items`、`item_images`、`item_status_logs`、`claim_comments`、`direct_shares`、
   `handover_records`、`thanks_messages`、`contribution_events`、`notifications`、
   `conversations`、`conversation_members`、`messages`。
2. **物品**：上架（分步表單：基本資料→圖片→確認）、編輯、我的分享、列表（縣市/分類/關鍵字篩選、
   cursor 分頁）、詳情。狀態機（MVP 簡化版）：
   ```
   draft → published → reserved → handover_pending → completed
                    ↘ expired / removed_by_user / removed_by_moderator
   ```
   （`pending_review`、抽籤相關狀態保留在 enum，M2/M5 啟用。）
3. **留言需要**：登入者對 published 物品留言表達需要（一物一人一留言，unique constraint）；
   分享者從留言中挑人接受 → 物品轉 `reserved`；可設「先到先得」（第一個留言自動接受，
   transaction + row lock 防搶）。
4. **直贈**：分享者直接指定某使用者贈與，對方接受/婉拒/逾時（72h）失效。
5. **交接與完成**：接受後建立 handover，自動開雙人 conversation（polling，僅文字）；
   雙方任一方標記完成＋對方確認 → `completed`（idempotency 防重複確認）；被接受者未取消
   而未出現 → 分享者可標記 no_show。
6. **感謝與貢獻值**：完成後接手者可留感謝；`contribution_events` 記分（分享完成 +10、
   接手完成 +2、no_show -5，數值進 config 不寫死）；個人頁顯示共享值。
7. **站內通知（最小版）**：被留言、被接受、被直贈、交接訊息、完成確認，各發一則站內通知；
   通知中心列表＋未讀數。polling，無推播。
8. E2E：Playwright 跑通「A 上架 → B 留言 → A 接受 → 私訊 → 雙方完成 → B 感謝」全流程。

### 不做（scope guard）
- 不做抽籤（M5）、不做審核流（先發後審）、不做檢舉（M2）、不做優惠券欄位（M3）、
  不做已讀回條與 realtime、不做排行榜與徽章（M3 後視情況）。

### 驗收清單
- [ ] E2E 主迴路測試綠（兩個測試帳號全流程）。
- [ ] 併發驗證：兩個請求同時搶「先到先得」→ 恰好一人成功（寫整合測試用 `Promise.all` 打同一端點）。
- [ ] 重複留言被 409 擋下；B 無法接受/編輯 A 的物品（403）；未登入留言 401。
- [ ] 非交接雙方的第三人讀取該 conversation → 404/403。
- [ ] 列表在 500 筆假資料下分頁正常、查詢用到索引（`EXPLAIN` 確認無 seq scan on items 主查詢）。
- [ ] judgment-rubrics §5 三組底線逐條過。

---

## 7. M2 — 治理底線（v0.5）

**目標**：出事的時候站長有工具可管：檢舉、下架、限制使用者、看紀錄。
**依賴**：M1。

### 交付內容
1. 資料表：`reports`、`report_evidence`、`user_restrictions`、`item_removals`、
   `support_tickets`、`support_ticket_events`、`support_ticket_attachments`、
   `appeals`、`appeal_evidence`、`keyword_blocklist`、`feature_flags`。
2. **檢舉**：對物品/留言/私訊檢舉（分類：詐騙、私下收費、違禁品、食品疑慮、騷擾、其他）＋附件；
   狀態機 `submitted → triaged → in_progress → resolved/rejected → closed`。
3. **強制下架**：moderator/admin 對物品強制下架（必填原因＋備註），通知物主，寫 audit log。
4. **功能限制**：對使用者禁上架/禁留言/禁私訊（可設期限）；封鎖（全站唯讀）。API 層統一檢查。
5. **使用者回報**（support tickets）：bug 與帳號問題入口＋後台處理。
6. **申訴**：被下架/被限制者可申訴一次，admin 複審。
7. **後台最小集** `/admin`：待辦總覽（未處理檢舉/申訴/回報數）、物品管理（搜尋＋下架）、
   使用者管理（搜尋＋限制）、audit log 查詢。
8. **rate limit**（DB-based 起步）：留言、上架、檢舉、私訊、上傳各設每小時/每日上限；
   關鍵字黑名單攔上架標題與描述。
9. Feature flag 機制（DB config 表）＋ `REQUIRE_REVIEW` 開關（開了之後上架進 `pending_review`，
   後台出現審核佇列）。

### 驗收清單
- [ ] 檢舉→處理→下架→物主收到通知→申訴→複審，全流程實跑通過。
- [ ] 被禁言者留言 → 403 且訊息明確；被封鎖者所有 mutation 皆 403。
- [ ] 每個管理操作在 `audit_logs` 有紀錄（actor、action、target、時間）。
- [ ] moderator 不能改 admin 的權限（RBAC 邊界測試）。
- [ ] rate limit 生效：第 N+1 次留言回 429。
- [ ] 打開 `REQUIRE_REVIEW` flag：新上架進審核佇列、通過後才公開。

---

## 8. M3 — 到期與優惠券（v0.6）

**目標**：支撐「優惠券／即期品」這兩類時效性最強、也最能冷啟動的物品。
**依賴**：M1。M2 未完成時技術上仍可做 M3，但券碼濫用（已用券仍上架等）要靠 M2 的檢舉機制
才能處理——若使用者要求先做 M3，提醒此風險後照做。

### 交付內容
1. 資料表：`coupon_details`、`coupon_secrets`、`coupon_reveal_logs`、`item_expiration_logs`、
   `system_jobs`、`system_job_runs`。
2. 物品加 `expires_at`；優惠券子表單（面額、適用店家、到期日）；即期食品規則
   （僅完整包裝、未開封、常溫、未過期——上架表單強制勾選確認）。
3. **券碼安全**：券碼 AES-256-GCM 加密存 `coupon_secrets`；只有接手確認後才可揭露；
   每次揭露寫 `coupon_reveal_logs`。
4. **到期 job**：每日（Zeabur cron 或外部 cron 打 `CRON_SECRET` 保護的 route）：
   到期物品轉 `expired`＋通知物主；即將到期（3 天前）提醒；列表「即將到期」排序加權。
5. **優惠券錢包** `/me/wallet`：我分享的券、我接手的券、狀態一目了然。
6. 正常過期不扣分；明知過期仍上架/券碼已用仍上架 → 屬違規走 M2 檢舉。

### 驗收清單
- [ ] 券碼在 DB 中為密文（直接查 DB 驗證）；未確認接手前 API 不回券碼；揭露有 log。
- [ ] 手動觸發到期 job：過期物品轉 expired、物主收到通知、job run 有紀錄。
- [ ] 到期 job 重複觸發不重複通知（idempotent）。
- [ ] 錢包頁正確分列已分享/已接手。

---

## 9. M4 — 通知強化（v0.7）

**目標**：使用者不開網站也收得到關鍵事件；通知不吵。
**依賴**：M1。

### 交付內容
1. 資料表：`notification_preferences`、`notification_deliveries`、`telegram_accounts`、
   `telegram_link_tokens`、`telegram_updates`（webhook update_id 去重用）。
2. 通知偏好頁：每類事件可關；預設站內全開、外部通知僅關鍵事件（被接受、交接訊息、即期提醒）。
3. **Telegram Bot**：綁定流程（站內產 token → TG 深連結驗證）；webhook（secret header 驗證、
   update_id 去重）；發送失敗重試＋失效自動解綁。
4. 通知合併：30 分鐘窗口內同物品事件合併；每人每日外部通知上限（預設 20）。

### 驗收清單
- [ ] 綁定→收到 TG 通知→解綁，全流程實跑。
- [ ] 偽造 webhook（錯 secret）→ 拒收；重放同 update_id → 不重複處理。
- [ ] 關掉某類通知後該事件確實不發；每日上限觸頂後停止外送但站內通知照常。

—— **v1.0 公開試用砍線**：M0–M4 全過＋§12 檢查表全過，即可公開試用。——

---

## 10. M5–M8（公開試用後，各自開工前再細化）

以下各節刻意只寫到「範圍＋關鍵約束」。**開工前由當時的 session 先產出該 milestone 的細部規格
（交付內容＋驗收清單，格式比照 M0–M4），經使用者確認後再實作。**

### M5 抽籤（v1.1）
- 範圍：物品可選「抽籤」模式；報名（unique 防重）、截止自動開獎（job lock 防重複執行）、
  中選者 48h 確認、逾時遞補、全程 `lottery_audit_logs` 可稽核。
- 關鍵約束：亂數用 crypto 級；開獎過程可重演驗證（記 seed 與名單快照）。

### M6 訂閱通知＋Web Push（v1.2）
- 範圍：關鍵字/分類/縣市訂閱（每人 20 個上限、每訂閱 5 關鍵字）、每日摘要（預設）、即時（預設關）、
  Web Push。同物品同訂閱只通知一次。

### M7 資料權利與法務（v1.3）
- 範圍：資料匯出（打包到 MinIO、7 天自動刪）、帳號刪除（去識別化保留必要紀錄）、retention 政策
  照 v1 §4.5 表執行、legal request/hold 流程。
- 關鍵約束：legal hold 目標資料不得被任何清理 job 刪除。

### M8 營運強化（v1.4）
- 範圍：storage 用量儀表板、慢查詢紀錄、備份還原演練（runbook＋實際演練一次）、
  健康檢查儀表板、通知失敗重送。

---

## 11. 參考附錄（設計已定案的細節，實作該 milestone 時查閱）

### 11.1 完整資料表清單（依 milestone 標注）
- M0：users, accounts, sessions, profiles, user_roles, audit_logs, categories, cities, storage_objects
- M1：items, item_images, item_status_logs, claim_comments, direct_shares, handover_records,
  thanks_messages, contribution_events, notifications, conversations, conversation_members, messages
- M2：reports, report_evidence, user_restrictions, item_removals, support_tickets,
  support_ticket_events, support_ticket_attachments, appeals, appeal_evidence, keyword_blocklist,
  feature_flags
- M3：coupon_details, coupon_secrets, coupon_reveal_logs, item_expiration_logs, system_jobs, system_job_runs
- M4：notification_preferences, notification_deliveries, telegram_accounts, telegram_link_tokens, telegram_updates
- M5：lotteries, lottery_entries, lottery_results, lottery_audit_logs
- M6：user_subscriptions, subscription_keywords, subscription_categories, subscription_cities,
  subscription_matches, subscription_digest_jobs, web_push_subscriptions
- M7：privacy_requests, data_exports, data_retention_policies, data_purge_logs,
  law_enforcement_requests（相關表組）, legal_holds（相關表組）
- M8：health_checks, error_logs, performance_metrics, storage_usage_snapshots
- 後移未排：badges/user_badges/leaderboard_*（徽章排行榜——等有活躍使用者再說）、
  sensitive_access_logs（M2 併入 audit_logs 加 `sensitive` 欄位起步，量大再拆表）

### 11.2 必備索引（建表時一併建）
```
items(status, city_id, category_id, created_at)
items(status, expires_at)
items(owner_id, status, created_at)
claim_comments(item_id, status, created_at)  + unique(item_id, user_id)
direct_shares(receiver_id, status, created_at)
messages(conversation_id, created_at)
notifications(user_id, read_at, created_at)
reports(status, created_at)
contribution_events(user_id, created_at)
audit_logs(actor_id, created_at)
（M5+）lottery_entries unique(lottery_id, user_id)
（M6+）subscription_keywords(normalized_keyword)
```

### 11.3 併發保護對照（v1 §11.2 全數保留）
| 場景 | 保護 |
|---|---|
| 先到先得 | transaction + row lock |
| 重複留言 | unique(item_id, user_id) |
| 抽籤重複報名 | unique(lottery_id, user_id) |
| 抽籤重複開獎 | job lock |
| 完成共享重複確認 | idempotency key |
| Telegram webhook 重複 | update_id 去重 |
| 通知重複 | delivery idempotency |

### 11.4 快取策略（v1 §10.3 保留；MVP 先靠 Next.js 內建即可）
分類/縣市 long cache；首頁熱門 short cache；私訊/券碼/檢舉/法務 一律不快取。

### 11.5 資料保留（v1 §4.5 表全數保留，M7 實作，之前一律不主動刪）

### 11.6 頁面地圖
v1 §7 的前後台頁面清單全數有效，但按 milestone 分批實作：M0–M1 做前台核心頁
（首頁/列表/詳情/上架/我的分享/我的需要/私訊/通知/個人頁/新手說明），M2 做治理頁與後台最小集，
其餘隨對應 milestone。`/terms`、`/privacy`、`/rules` 三個靜態頁在 §12 上線前補。

### 11.7 安全風險對照（v1 §12.2 全數保留）
IDOR→object-level permission；XSS→escape+sanitize；CSRF→protected mutation；
Upload→magic bytes；Webhook→secret header；券碼→加密+reveal log；管理員→audit log；
洗版→rate limit。實作時對照 judgment-rubrics §5a 驗。

---

## 12. 公開試用前檢查表（v1.0 gate，缺一不可上線）

- [ ] `/terms`、`/privacy`、`/rules`（禁止品項含食品規範）三頁完成——內容先由模型起草、
      **使用者過目**；正式營運前建議台灣律師審閱（模型無法替代，明確標註）。
- [ ] Zeabur 方案評估：Free Plan 的 auto-sleep 與容量限制是否可接受，不行就升級（要花錢，問使用者）。
- [ ] 備份：至少手動備份 runbook 寫好並實際演練還原一次。
- [ ] 壓測煙霧測試：500 物品/50 使用者假資料下列表與查詢 P95 < 1s。
- [ ] 權限越權掃描：用 fresh agent 依 §11.7 清單逐項攻擊測試。
- [ ] OAuth 正式憑證（Google 審核）、正式網域、Telegram Bot 正式帳號。

## 13. 本檔維護

- 勾選進度、為 M5–M8 補細部規格：任何 session 可做（照 maintenance-protocol.md）。
- 改動已定案決策（§1 non-goals、§2 技術棧、§4 砍線、§12 gate）：**必須先問使用者**。
