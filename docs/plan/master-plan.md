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
AUTH_URL                # 站台 URL（Auth.js v5 用 AUTH_* 前綴，非 v4 的 NEXTAUTH_*）
AUTH_SECRET             # Auth.js session 加密
AUTH_TRUST_HOST         # 反向代理後設 true（Zeabur 需要）
AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET   # MinIO
S3_PUBLIC_URL           # 圖片對外讀取的 base URL
COUPON_SECRET_KEY       # M3 起：券碼加密（AES-256-GCM）
TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET              # M4 起
CRON_SECRET             # 保護 job 觸發 route
TZ=Asia/Taipei          # 全站顯示台北時間（2026-07 已於正式站設定；本機開發也建議設）
```
- secrets 只放環境變數；repo 內放 `.env.example`（只有 key 沒有值）。
- **時區**：所有時間顯示（物品建立時間、到期時間、通知時間戳）一律以 `Asia/Taipei` 為準，
  伺服器環境變數設 `TZ=Asia/Taipei`；前端顯示時間一律走這個時區，不要用 UTC 或使用者瀏覽器時區。

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

### 3.7 SEO 與 AEO 友善（全站慣例，使用者指定需求）

目標：公開內容要能被搜尋引擎收錄（SEO），也要能被 AI 答案引擎正確引用（AEO）。

- **公開頁一律 server-render**（SSR/SSG）：首頁、物品列表、物品詳情、`/guide`、`/rules`、
  `/terms`、`/privacy`、個人公開頁。驗法：`curl` 該頁（無 JS）能看到主要內容文字。
- **Metadata**：每頁用 Next.js Metadata API 給唯一的 title/description；物品詳情用物品名＋縣市
  組 title；全站 `lang="zh-TW"`；canonical URL。
- **Open Graph**：公開頁有 og:title/description/image（物品頁用第一張 medium 圖）。
- **結構化資料（JSON-LD）**：物品詳情頁 `Product`＋`Offer`（price 0、priceCurrency TWD、
  availability 對應物品狀態）；首頁 `WebSite`＋`Organization`；`/guide` 用 `FAQPage`；
  列表頁 `BreadcrumbList`。
- **sitemap.xml**（動態：published 物品＋靜態頁）與 **robots.txt**；
  私有頁（`/me/*`、`/admin/*`、`/messages`、API）一律 `noindex` 且 robots 禁爬。
- **AEO**：站根提供 `llms.txt`（站點說明＋主要頁面索引）；`/guide` 與 `/rules` 用清晰的
  問答式標題結構（H2 提問、段落作答），方便答案引擎摘錄；URL 穩定不改（物品頁 `/items/[id]`）。
- 效能即 SEO：圖片走 §3.3 管線＋`next/image`，公開頁避免不必要的 client component。
- **驗收（併入各 milestone）**：M0 起 robots.txt/lang/基礎 metadata；M1 起物品頁 JSON-LD、
  sitemap、OG、curl 無 JS 可讀；v1.0 gate（§12）加：Lighthouse SEO 分數 ≥ 90、
  Google Rich Results Test 對物品頁通過。

### 3.8 Git
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
10. SEO 基礎（見 §3.7）：`robots.txt`、`llms.txt`、root layout 設 `lang="zh-TW"` 與全站預設
    metadata、私有路徑 noindex。

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
8. SEO/AEO（見 §3.7）：物品詳情與列表 SSR、每頁 metadata＋OG、物品頁 JSON-LD（Product/Offer）、
   動態 sitemap.xml。
9. E2E：Playwright 跑通「A 上架 → B 留言 → A 接受 → 私訊 → 雙方完成 → B 感謝」全流程。

### 不做（scope guard）
- 不做抽籤（M5）、不做審核流（先發後審）、不做檢舉（M2）、不做優惠券欄位（M3）、
  不做已讀回條與 realtime、不做排行榜與徽章（M3 後視情況）。

### 驗收清單
- [ ] E2E 主迴路測試綠（兩個測試帳號全流程）。
- [ ] 併發驗證：兩個請求同時搶「先到先得」→ 恰好一人成功（寫整合測試用 `Promise.all` 打同一端點）。
- [ ] 重複留言被 409 擋下；B 無法接受/編輯 A 的物品（403）；未登入留言 401。
- [ ] 非交接雙方的第三人讀取該 conversation → 404/403。
- [ ] 列表在 500 筆假資料下分頁正常、查詢用到索引（`EXPLAIN` 確認無 seq scan on items 主查詢）。
- [ ] SEO：`curl` 物品詳情頁（無 JS）看得到標題與描述文字；頁面含 Product JSON-LD；
      `/sitemap.xml` 列出 published 物品。
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
4. **到期 job**：每日定時打 `CRON_SECRET` 保護的 route。觸發器二選一（2026-07 查證：Zeabur
   平台無內建 cron，但模板市場有）：(a) 一站式——同專案部署 Cronicle（模板代碼 BMJPXE，原生支援
   定時 HTTP request）或 Crontab UI（ZI541Z），多一個小常駐容器；(b) 零成本——外部免費 cron
   （cron-job.org 或 GitHub Actions schedule）。實作 M3 時讓使用者選。
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

M7 已依照上面的要求產出細部規格，見緊接在下面的 §7a（格式比照 M0–M4）；**這份細部規格需經
使用者確認、且法務相關段落需經台灣律師審閱後，才能進入實作**。M5、M6、M8 仍維持粗綱，
比照本節開工前的原則，各自開工前再產出。

### M5 抽籤（v1.1）
- 範圍：物品可選「抽籤」模式；報名（unique 防重）、截止自動開獎（job lock 防重複執行）、
  中選者 48h 確認、逾時遞補、全程 `lottery_audit_logs` 可稽核。
- 關鍵約束：亂數用 crypto 級；開獎過程可重演驗證（記 seed 與名單快照）。

### M6 訂閱通知＋Web Push（v1.2）
- 範圍：關鍵字/分類/縣市訂閱（每人 20 個上限、每訂閱 5 關鍵字）、每日摘要（預設）、即時（預設關）、
  Web Push。同物品同訂閱只通知一次。

## 7a. M7 — 資料權利與法務（v1.3，細部規格）

> ⚠️ **法律免責聲明（本節開頭）**：本節所有與資料保留期限、legal hold 範圍認定、警方/檢調調閱
> 流程相關的判斷，僅為**技術實作參考**，不構成法律意見、不能替代律師意見。正式營運前，本節內容
> （尤其「帳號刪除去識別化範圍」「retention 期限表」「警方調閱是否通知當事人」三處）必須經
> **台灣律師與平台法務審閱**後才能上線；審閱前僅供工程團隊理解系統設計之用。

**目標**：讓使用者對自己在 ShareGood 留下的資料有匯出與刪除的自助管道（對應台灣個資法對資料
當事人「查詢、閱覽、複製、刪除」權利的基本技術支援），同時把「哪種資料留多久」「什麼時候真的
清掉」訂成一致、可設定、可稽核的規則，並確保這套自動清理機制**不會**誤刪正在被檢舉調查、訴訟中、
或警方/檢調正式調閱中的資料。

**依賴**：
- M0：`storage_objects`（`StorageKind` 已預留 `export_package`，本規格的匯出包直接沿用這張表與
  既有孤兒檔清理慣例，不新增獨立的 MinIO 路徑規則）。
- M1：`items`/`item_images`/`claim_comments`/`direct_shares`/`handover_records`/
  `thanks_messages`/`contribution_events`/`conversations`/`conversation_members`/`messages`/
  `notifications`——資料匯出要打包這些表裡屬於當事人的資料；帳號刪除要決定這些表裡哪些欄位
  改寫、哪些整列保留。
- M2：`reports`/`appeals`/`audit_logs`——`audit_logs` 是本規格所有刪除/去識別化/調閱動作的落點；
  `reports`/`appeals` 是 legal hold 最常見的觸發來源（例如物品涉詐正在調查中）。
- M3：`system_jobs`/`system_job_runs`——本規格新增的三個排程 job（資料匯出過期清除、
  retention 清理、帳號刪除去識別化執行）全部掛在這套既有的 `CRON_SECRET` 保護 route + 執行紀錄
  機制上，不重新發明；`coupon_secrets`/`coupon_reveal_logs`——legal hold 與去識別化都要考慮
  這兩張表（reveal log 是稽核紀錄，行為與 `audit_logs` 一致：長期保留、legal hold 適用）。

### 交付內容

#### 1. 資料表（依 §11.1 定案表名；欄位為本規格設計，命名依 §3.1 慣例）

**`privacy_requests`**（使用者對自己資料提出的請求，匯出與刪除共用一張表，用 `type` 區分）：
```
id
user_id            FK -> users.id
type               PrivacyRequestType   -- data_export | account_deletion
status             PrivacyRequestStatus -- 見下方狀態機（兩種 type 的狀態機不完全共用，見下）
reason             text, nullable       -- 刪除帳號時可選填原因，不強制
cooling_off_until  timestamptz, nullable -- 僅 account_deletion：冷卻期到期時間，見下方「帳號刪除」
processed_by       FK -> users.id, nullable -- 系統排程自動執行完成時為 null；若因 legal_hold
                                             -- 需人工介入處理則記錄介入的 admin
created_at / updated_at / completed_at (nullable)

enum PrivacyRequestType { data_export, account_deletion }
enum PrivacyRequestStatus {
  submitted     -- 使用者剛送出
  cooling_off   -- 僅 account_deletion：進入冷卻期，使用者仍可撤銷
  confirmed     -- 冷卻期滿（data_export 無冷卻期，送出即視同 confirmed）
  processing    -- job 正在執行
  completed
  cancelled     -- 使用者在冷卻期內主動撤銷
  rejected      -- 例如命中 legal_hold 而暫時無法執行，見下方
}

@@index([user_id, type, created_at])
@@index([status, cooling_off_until])  -- job 掃描冷卻期到期用
```

**關聯方向刻意設計成「特定表指回通用表」，不是反過來**：`data_exports` 持有
`privacy_request_id FK -> privacy_requests.id`（見下方 `data_exports` 定義），而不是
`privacy_requests` 持有 `data_export_id`。理由：後者是「通用父表指向特定子表」的反向關聯，
會強迫 `privacy_requests.data_export_id` 必須 nullable，且建立資料時得先有 `data_exports.id`
才能回填，順序彆扭；改成 `data_exports.privacy_request_id` 之後，建立流程自然是「先建
`privacy_requests`（拿到 id）→ 再建 `data_exports` 帶入這個 id」，且 `data_exports` 要找到
自己對應的請求只需要一個 FK，`privacy_requests` 要找到自己的匯出細節則用反向關聯查詢
（`db.dataExport.findUnique({ where: { privacyRequestId } })`），不需要在 `privacy_requests`
本身存一個可能過期/不同步的 FK。

**`data_exports` 完成或失敗時必須同步寫回 `privacy_requests.status`**（否則 `/me/settings`
前台一直顯示 `confirmed`/`processing`，使用者看不到真正結果）：`data_exports.status` 轉
`ready` 時，同一個 transaction 裡把對應 `privacy_requests.status` 轉 `completed`＋寫入
`completed_at`；轉 `failed` 時對應轉 `rejected`（`processed_by` 維持 null，代表系統自動執行，
非人工介入）。

**`data_exports`**：
```
id
user_id            FK -> users.id
privacy_request_id FK -> privacy_requests.id @unique  -- 一個請求最多一筆匯出細節
status             DataExportStatus  -- pending | processing | ready | expired | failed
storage_object_id  FK -> storage_objects.id, nullable  -- 打包完成後才寫入，kind=export_package
requested_at
ready_at           nullable
expires_at         nullable  -- = ready_at + 7 天
download_count     int default 0     -- 純觀察用，不做下載次數限制
last_downloaded_at nullable
failure_reason     text, nullable
created_at / updated_at

@@index([status, expires_at])  -- 過期清除 job 用
@@index([user_id, created_at])
```

**`data_retention_policies`**：
```
id
policy_key      text @unique  -- 例：'messages_after_completion'、'notifications'、
                               -- 'item_images_completed'、'data_exports'（見下方完整表）
description     text          -- 後台顯示用中文說明
retention_days  int, nullable    -- null = 不自動清理（長期保留，例如 audit_logs）
action          RetentionAction, nullable  -- purge | anonymize | downgrade | archive；
                                  -- retention_days 為 null（長期保留、不清理）時 action 也是
                                  -- null，兩者同時為 null 才合法，retention_purge job 掃描時
                                  -- 用 `retention_days IS NOT NULL` 當作「這筆政策要不要處理」
                                  -- 的判斷依據，不會誤把「不清理」的政策當成 action 打錯值
is_active       boolean @default(true)
updated_by      FK -> users.id, nullable
created_at / updated_at

enum RetentionAction { purge, anonymize, downgrade, archive }
```

**`data_purge_logs`**（每次 retention job 對任一筆資料真的動手，都寫一筆；此表本身比照
`audit_logs` 長期保留、不可被任何清理 job 清掉）：
```
id
policy_key          text          -- 快照當下的 policy_key（不設 FK，policy 之後改名/刪除
                                   -- 不影響這筆歷史紀錄的可讀性）
job_run_id          FK -> system_job_runs.id, nullable
target_type         text          -- 'item_image' | 'message' | 'notification' |
                                   -- 'coupon_reveal_log' | 'thanks_message' 等
target_id           text
action_taken        RetentionAction
skipped_legal_hold  boolean @default(false)  -- true = 命中 legal hold，本次跳過未執行
created_at

@@index([policy_key, created_at])
@@index([target_type, target_id])
```

**`law_enforcement_requests`（相關表組，機關調閱請求）**：
```
law_enforcement_requests:
  id, agency_name, case_reference, legal_basis(text，來文所附法源條文),
  request_scope(text，例如「OO 使用者近 90 天私訊」),
  received_at(公文實際到站日期，可能早於建檔時間),
  status LawEnforcementRequestStatus,
  submitted_by FK->users.id（建檔的 admin/客服）,
  approved_by FK->users.id nullable（核准的法務/站長，見下方「誰能核准」）,
  approved_at nullable, rejection_reason nullable,
  notify_user boolean @default(true)（是否通知當事人，預設要通知，除非法律或法院裁定不得通知——
    見下方「是否通知當事人」）,
  notified_at nullable,
  created_at / updated_at

  enum LawEnforcementRequestStatus {
    submitted      -- 客服/admin 收到公文並建檔
    legal_review   -- 待法務/站長審閱
    approved
    rejected
    fulfilled      -- 已產出並交付 law_enforcement_exports
    closed
  }

law_enforcement_request_targets:  id, request_id FK, target_type, target_id
  -- target_type: user | item | conversation | message
law_enforcement_request_documents:  id, request_id FK, storage_object_id FK->storage_objects.id
  （掃描公文檔案，kind 需在 StorageKind 新增一個值，本規格建議 law_enforcement_document——
    這是給未來實作 session 修改 schema.prisma 時的建議，本次不動 schema）,
  uploaded_by, created_at
law_enforcement_request_events:  id, request_id FK, action, actor_id nullable, note, created_at
  -- 稽核用，逐筆記錄狀態轉換與備註，讀出來要能還原完整處理時間序
law_enforcement_exports:  id, request_id FK, storage_object_id FK->storage_objects.id
  （比照上面建議，StorageKind 新增 law_enforcement_export；只有 admin 角色以上、且被記錄在
  law_enforcement_request_events 才能取得下載連結，不對外開放一般 admin）,
  generated_at, expires_at nullable（依案件，可能不設過期，屆時由 legal_holds 保護避免誤刪）
```

**`legal_holds`（相關表組）**：
```
legal_holds:
  id, reason, related_request_id FK->law_enforcement_requests.id nullable
    （也可能源自站內檢舉/內部訴訟而建立，不一定源自警方請求，故允許 null）,
  status LegalHoldStatus, created_by FK->users.id, released_by FK->users.id nullable,
  released_at nullable, created_at / updated_at

  enum LegalHoldStatus { active, released }

legal_hold_targets:
  id, legal_hold_id FK, target_type, target_id
  -- target_type 建議至少涵蓋：user | item | conversation | message | handover_record |
  --   claim_comment | direct_share | thanks_message | coupon_reveal_log | report
  @@index([target_type, target_id])  -- isUnderLegalHold() 的核心查詢索引，必建
legal_hold_events:
  id, legal_hold_id FK, action（created/target_added/target_removed/released）,
  actor_id FK->users.id nullable, note, created_at
```

#### 2. 資料匯出流程

- 觸發：`/me/settings` 新增「匯出我的資料」按鈕 → `POST /api/me/data-exports`。Server-side 檢查：
  同一使用者 24 小時內只能有一筆非終態（`pending`/`processing`）的匯出請求，超過回 409（避免
  重複觸發浪費運算與 storage）。建立 `privacy_requests`（type=data_export, status=confirmed，
  data_export 無冷卻期）與 `data_exports`（status=pending）各一筆，同一 transaction。
- **打包內容**（依使用者為中心，列出所有「這個使用者是誰」相關的資料，比照個資法「機器可讀的
  個人資料複本」精神，但格式選擇清楚易讀的 JSON + 一個 README.txt 說明各檔案內容，不特別遵循
  國際標準格式——見下方「不做」）：
  - `profile.json`：`User`（不含其他使用者可見的內部 id 以外資訊）、`Profile`（暱稱、縣市、
    自我介紹）。
  - `items.json`：使用者名下所有 `Item`（含已下架/已完成）與其 `ItemImage`（存物品圖片的
    thumb/medium 下載連結，見下方簽名 URL）。
  - `claims.json`：使用者發過的 `ClaimComment`。
  - `direct_shares.json`：使用者分享或收到的 `DirectShare`。
  - `handovers.json`：使用者參與的 `HandoverRecord`（不論身分是物主或接手者）。
  - `messages.json`：使用者參與的 `Conversation` 與其中的 `Message`（僅限使用者本人是
    `ConversationMember` 的對話；每則訊息含寄件人、時間、內容，對話另一方若非本人只顯示
    使用者當時的暱稱快照，不額外揭露對方帳號的其他資料）。
  - `thanks.json`：使用者發出或收到的 `ThanksMessage`。
  - `contribution.json`：使用者的 `ContributionEvent` 完整紀錄與目前累積貢獻值。
  - `notifications.json`：使用者的 `Notification` 歷史。
  - `README.txt`：中文說明各檔案欄位意義、本次匯出產生時間、7 天內有效。
  - 圖片本身**不塞進 zip**（避免包過大），改在 `items.json`/`README.txt` 提供圖片的簽名下載
    連結列表，連結有效期與整包匯出的 `expires_at` 一致。
- **產生流程**：沿用 M3 建立的 `system_jobs`/`system_job_runs` 排程機制，新增 job kind
  `data_export_generate`：每次執行掃描 `data_exports.status='pending'`，逐筆處理（`status`
  轉 `processing` 當樂觀鎖，比照 M5 開獎 job 的條件式 UPDATE 防重複執行手法）→ 上述查詢組成
  JSON 檔案 → 壓縮成 zip → 呼叫既有 `putObject` 存進 MinIO，`objectKey` 建議
  `exports/{userId}/{dataExportId}.zip`（沿用既有 `putObject`/`deleteObject`，不新增獨立
  bucket——單一 `S3_BUCKET` 是既有定案）→ 在 `storage_objects` 建一筆 `kind=export_package`、
  `uploaderId=userId` 的紀錄 → `data_exports.storage_object_id` 寫入、`status` 轉 `ready`、
  `ready_at=now()`、`expires_at=ready_at+7天` → 站內通知使用者「你的資料匯出已就緒，7 天內
  有效」。
- **下載連結必須簽名**：現有 `src/lib/storage.ts` 的 `publicUrl()` 只是串接 `S3_PUBLIC_URL` 的
  純文字組合，**沒有簽章**，只適合物品圖片這類本來就打算公開的內容；資料匯出包含使用者私訊、
  貢獻值等私密資料，**不可比照 `publicUrl()`**，必須新增一個用
  `@aws-sdk/s3-request-presigner` 的 `getSignedUrl(s3, new GetObjectCommand({Bucket, Key}),
  { expiresIn })` 產生的簽名 URL helper（例如 `getPresignedDownloadUrl(objectKey, expiresIn)`），
  短效期建議 15 分鐘一次性連結（`GET /api/me/data-exports/[id]/download` 每次呼叫都重新簽一個，
  不回傳固定網址），避免猜物件路徑（`exports/{userId}/{id}.zip` 雖然帶 userId 但不應該只靠
  「路徑不外流」當防護）就能下載別人的匯出包。
- **7 天自動清除**：新增 job kind `data_export_purge`（沿用 M3 機制），每日掃描
  `data_exports.status='ready' AND expires_at<=now()`：先呼叫 `isUnderLegalHold('data_export',
  id)`（見下方交付內容 5）確認未被保全，是則跳過並寫 `data_purge_logs`
  （`skipped_legal_hold=true`），否則 `deleteObject` 刪 MinIO 物件、`storage_objects.status`
  轉 `deleted`、`data_exports.status` 轉 `expired`，寫 `data_purge_logs`。此 job 本質上與既有
  M0 孤兒檔清理 job（`src/app/api/jobs/storage-cleanup/route.ts`）同構，可考慮共用同一支
  route 加 job 類型參數，或另開一支 route，實作時擇一即可，不影響本規格驗收。

#### 3. 帳號刪除流程

**設計決策（先講清楚，這是本節最重要的取捨）**：「去識別化保留必要紀錄」在本專案**必須實作成
應用層的欄位改寫，而不是刪除 `User` 資料列本身**。理由：

檢視現有 `prisma/schema.prisma` 的 `onDelete` 設定，`Item.owner`、`ClaimComment.user`、
`DirectShare.receiver`、`HandoverRecord.receiver`、`ThanksMessage.fromUser`/`toUser`、
`ConversationMember.user`、`Message.sender`、`ContributionEvent.user`、`Notification.user`、
`Account.user`、`Session.user`、`Profile.user`、`UserRole.user` 全部是 `onDelete: Cascade`
（只有 `AuditLog.actor` 與 `StorageObject.uploader` 是 `SetNull`）。這代表如果真的對 `users`
表下 `DELETE`，會連鎖刪掉：這個使用者名下所有物品（連帶物品上**其他人**留的
`ClaimComment`／`ThanksMessage`／`HandoverRecord`，因為那些表對 `Item` 也是 `onDelete:
Cascade`）、這個使用者對**別人**物品留的留言與感謝訊息、他參與過的所有對話與訊息。換句話說，
刪一個帳號會炸掉一堆跟他共享過的其他使用者的合法歷史紀錄——這正是本規格「別人留的感謝訊息、
已完成的交易紀錄、`contribution_events` 不能因為一方刪帳號就讓另一方的歷史紀錄消失」這條要求
明確禁止的結果。PR #16 把 `ItemRemoval.moderator`/`CouponRevealLog.user` 改成 `SetNull` 是為了
「刪除下架/揭露動作的執行者帳號時，稽核紀錄本身留著、只是執行人變成不可考」這個**不同的**場景
（那兩張表的主體是稽核紀錄本身，使用者只是紀錄裡的一個外鍵欄位）；但本規格要處理的是「刪除一個
在整個平台歷史裡同時是物主、留言者、對話參與者的活躍帳號」，牽涉的表遠多於這兩張、且大多是
`Cascade`，逐一把它們全部改成 `SetNull` 工程量大、且部分場景改 `SetNull` 後欄位語意會變得
奇怪（例如 `HandoverRecord.receiver` 若允許 null，`handover-section.tsx` 顯示「接手者」的
UI 邏輯要重寫成處理 null 的情況）。

因此本規格採用**軟刪除＋原地去識別化**：`User` 資料列**永遠不被實際 DELETE**，只是把可識別
的欄位改寫成佔位內容，`id` 不變，所有既有 FK 關聯完全不受影響，**不需要修改任何一個現有
`onDelete` 策略**。這是應用層的資料改寫，不是 schema 層的刪除策略——這正是任務要求要講清楚的
設計選擇。具體交付：

- **`User` model 需新增欄位**（給未來實作 M7 的 session 動 schema 時的建議，本規格本身不動
  `schema.prisma`）：`deletedAt DateTime?`。所有之後新增的查詢（個人頁、留言者顯示名稱等）
  在 `deletedAt` 非 null 時一律顯示去識別化後的內容。
- **欄位改寫對照表**：

  | 欄位 | 刪除後 |
  |---|---|
  | `User.name` | `"已刪除的使用者"` |
  | `User.email` | `deleted-{userId}@sharegood.invalid`（維持 `@unique` 約束合法；`.invalid`
    是 IANA 保留的無效網域，不會誤發信） |
  | `User.image` | `null` |
  | `User.emailVerified` | `null` |
  | `User.deletedAt` | 執行當下時間 |
  | `Profile.nickname` | `"已刪除的使用者"` |
  | `Profile.bio` | `null` |
  | `Profile.cityId` | 保留不變（縣市本身不是可識別個資，且部分列表統計可能依賴它） |
  | `Account.*`（Google OAuth 綁定）、`Session.*` | **真的刪除**（不是改寫）：帳號已刪除不該
    再能登入，這兩張表只服務登入用途，刪除後對其他使用者資料無任何影響，且不違反
    `onDelete: Cascade` 語意（本來就該連 `User` 一起消失，只是這裡改成單獨刪這兩張表，
    `User` 本身不刪）。 |
  | `UserRole` | 真的刪除（去識別化後的帳號不該保留 admin/moderator 權限）。 |

- **保留不動的資料**（因為涉及其他使用者的權益，或本身是稽核用途）：`Item`（物品本身與
  `owner_id` 都保留，UI 顯示物主為「已刪除的使用者」；已 `published` 的物品建議在去識別化
  同一個 transaction 內強制轉 `removed_by_user`，避免已刪帳號的物品繼續掛在列表上）、
  `ClaimComment`、`DirectShare`、`HandoverRecord`、`ThanksMessage`（無論這個使用者是
  `fromUser` 還是 `toUser`）、`ContributionEvent`、`Message`/`ConversationMember`、
  `Notification`、`AuditLog`、`ItemStatusLog`——這些全部原封不動，只是介面渲染時查到
  `deletedAt` 非 null 的關聯使用者就顯示「已刪除的使用者」，不修改任何一筆紀錄本身。
- **觸發流程**：`/me/settings`「刪除我的帳號」→ 二次確認（要求輸入固定字串，例如「刪除我的
  帳號」，防止誤觸）→ `POST /api/me/privacy-requests`（`type=account_deletion`）建立
  `privacy_requests`（`status=cooling_off`、`cooling_off_until=now()+7天`）→ 期間使用者仍可
  用 `DELETE /api/me/privacy-requests/[id]` 撤銷（`status` 轉 `cancelled`）——7 天冷卻期是為了
  避免帳號被盜情境下遭惡意刪除、或使用者衝動決定後反悔，且與 M1 直贈的 72h 逾時、M5 抽籤的 48h
  確認同屬「重要且不可逆的動作要留緩衝期」這個一貫的產品判斷。冷卻期滿由新增 job kind
  `account_deletion_execute`（沿用 M3 機制，每日掃描 `status='cooling_off' AND
  cooling_off_until<=now()`）執行：**先呼叫 `isUnderLegalHold('user', userId)`**——命中則
  `privacy_requests.status` 轉 `rejected`、`processed_by` 記錄系統判斷原因，站內通知使用者
  「帳號因法律程序原因暫無法刪除，請聯繫客服」（不揭露案件細節，這塊本身即涉法律判斷，交由
  客服人工跟進），否則執行上述欄位改寫，`status` 轉 `completed`，寫 `audit_logs`
  （`action=user.account_deleted`、`sensitive=true`）。
- **與 `/u/[userId]` 公開個人頁的關聯**：去識別化後訪問該頁應顯示「已刪除的使用者」，不再顯示
  真實暱稱；累積貢獻值總數可選擇繼續顯示（貢獻值本身不是個資，且移除它會讓曾與其共享過的人的
  頁面連結出現困惑的「查無此人」情況），但暱稱一律換成佔位字串。

#### 4. Retention 政策（轉譯自 v1 §4.5，欄位設計見交付內容 1 的 `data_retention_policies`）

以下為建議的初始 seed 資料（`data_retention_policies` 每列一筆，`is_active=true`），實際數字
使用者可事後在後台調整，不寫死在程式碼裡：

| `policy_key` | 對應資料 | `retention_days` | `action` |
|---|---|---|---|
| `item_metadata_public` | 公開物品 metadata | `null`（長期保留/封存，不自動刪） | archive |
| `item_images_completed` | 已完成物品圖片 | 180 | downgrade（只留 thumb，刪 medium/large） |
| `item_images_coupon_expired` | 過期優惠券圖片 | 90～180（建議先設 120） | purge |
| `item_images_perishable_expired` | 即期好物圖片（metadata 留存） | 90 | purge（僅刪圖片，
    `Item`/`ItemImage` 列本身保留，只清 `storage_objects` 對應物件與 medium/large key） |
| `messages_after_completion` | 私訊（完成共享後） | 90 | archive（爭議中或 legal hold 不刪，
    見交付內容 5） |
| `notifications` | 通知 | 90 | purge |
| `telegram_raw_updates` | Telegram raw update（M4 起） | 7～30（建議 14） | purge |
| `web_push_endpoints_inactive` | 失效 Web Push endpoint（M6 起） | 0（失效即刪，非時間制） | purge |
| `report_appeal_evidence` | 檢舉／申訴證據 | 180～365（建議 270） | purge（legal hold 例外） |
| `audit_logs` | audit log | `null`（長期保留） | — |
| `sensitive_access_logs` | 敏感調閱紀錄 | `null`（長期保留） | — |
| `data_exports` | 資料匯出包 | 7 | purge（見交付內容 2） |
| `law_enforcement_exports` | 法務匯出包 | `null`（依案件，過期後手動或另訂；交付紀錄
    `law_enforcement_request_events` 永久保留） | archive |

`data_retention_policies` 定位為**可設定的執行依據**，不是純文件記錄表：所有 retention 相關
job（交付內容 2 的匯出過期清除、本節的 retention 清理 job、既有孤兒檔清理）在執行前都要先
`SELECT` 這張表拿 `retention_days`/`action`，而不是把天數寫死在程式碼常數裡——政策未來若要
調整（例如法規變動、儲存成本考量），後台改一筆設定即可生效，不需要改程式碼重新部署。新增
job kind `retention_purge`（沿用 M3 機制，每日執行）：逐一走過 `is_active=true` 的政策列，
依 `policy_key` 對應到實際查詢（例如 `messages_after_completion` 對應查
`HandoverRecord.completedAt <= now() - retention_days` 的物品底下的 `Message`），**批次檢查
legal hold、不對每筆命中資料各自查一次**（單一政策命中資料可能上千筆，逐筆呼叫
`isUnderLegalHold` 會是 N+1 查詢，嚴重拖慢 job 且佔用大量資料庫連線）：先撈出這批命中資料
的全部 `id`，用一次 `legal_hold_targets.findMany({ where: { targetType, targetId: { in: ids },
status: 'active' } })` 查出「這批裡面哪些正被 legal hold 命中」，在記憶體中用這份結果集過濾掉
命中的 id，剩下的才批次執行 `action`；每筆動作（含被 legal hold 擋下而跳過的）都寫一筆
`data_purge_logs`。

#### 5. Legal hold 串接（橫切關注點）

共用 helper（建議放 `src/lib/legal-hold.ts`）：

```ts
async function isUnderLegalHold(
  targetType: string,
  targetId: string,
): Promise<boolean> {
  const hit = await db.legalHoldTarget.findFirst({
    where: { targetType, targetId, legalHold: { status: "active" } },
    select: { id: true },
  });
  return hit !== null;
}
```

`legal_hold_targets(target_type, target_id)` 索引是這個查詢的效能保證，必建（見交付內容 1）。

**所有會刪除或改寫資料的既有與未來清理邏輯，執行刪除/改寫前都必須呼叫這個 helper**，命中就跳過
並在 `data_purge_logs`（或該 job 自己的紀錄表）寫 `skipped_legal_hold=true`，清單：
- 本規格新增的三個 job：`data_export_purge`、`account_deletion_execute`、`retention_purge`。
- M0 既有孤兒檔清理 job（`src/app/api/jobs/storage-cleanup/route.ts`）：雖然只清理
  `status=pending` 且從未被引用過的暫存物件，理論上不會是 legal hold 目標，但保守起見仍建議
  補上檢查（成本低，避免未來 legal hold 的 `target_type` 擴充涵蓋 `storage_object` 時出現
  遺漏）。
- M3 到期 job（`item_expiration`）：物品到期轉 `expired` 本身不刪資料，不需要檢查；但若 M3
  之後衍生出「到期物品圖片清理」的動作，該動作需要檢查。
- 未來任何新增的清理/歸檔 job：**約定成俗**——任何 session 新增涉及刪除或不可逆改寫使用者
  資料的 job，落地前都要在 PR 描述裡回答「這支 job 有沒有呼叫 `isUnderLegalHold`」。

**Legal hold 的建立與解除**：由 admin 在後台（`/admin/legal-holds`，M2 後台最小集完成後才有
入口，M7 若先於後台完成，可先用直接的 API + 資料庫操作頂著）針對特定 `target_type`/`target_id`
建立 `legal_holds` + `legal_hold_targets`（一個 legal hold 可以同時保全多個目標，例如一起
詐騙案牽涉的 `user`、多個 `item`、多個 `conversation`）；解除需記錄 `released_by`/
`released_at`，`legal_hold_events` 寫入 `released` 事件。**只有 admin 角色可以建立/解除**
（比照 M2 RBAC 慣例），非 admin 呼叫回 403。

#### 6. 警方／檢調調閱流程（law enforcement request）

> ⚠️ 此節法律判斷（誰有權提出、如何驗證公文真偽、核准層級、是否通知當事人、揭露範圍是否符合
> 個資法「必要最小揭露」原則）**僅供技術實作參考，正式流程需台灣律師與平台法務審閱後才能上線**；
> 上線前，本流程建議先以「人工審核＋不做任何自動化核准」的方式運作。

- **誰能提出**：本流程**不對外開放 API**——調閱請求一律由執法/司法機關以正式公文（紙本或政府
  對口信箱）送達站方，站方客服/admin 收到後**手動**在 `/admin/legal-requests` 建檔
  （`law_enforcement_requests` + 上傳公文掃描檔到 `law_enforcement_request_documents`），
  不做「機關線上送單」的自助介面（降低偽冒公文的風險，收文管道限制在站方既有聯絡窗口）。
- **誰能核准**：建檔（`submitted_by`）與核准（`approved_by`）**必須是不同人**（雙人審核，防止
  單一 admin 濫權調閱使用者私訊等敏感資料）；核准者角色建議限定為 `admin` 且由使用者/站長
  指定的「法務窗口」帳號（M7 v1 先用既有 `admin` role 頂著，人數少的階段以流程紀律取代額外
  RBAC 角色；使用者量變大後可考慮新增 `legal_reviewer` role，屬未來擴充，不在本次範圍）。
  核准前 `status=legal_review`；核准通過 `status=approved`、`approved_by`/`approved_at` 寫入；
  不通過 `status=rejected`、`rejection_reason` 必填。
- **核准後怎麼提供資料**：`status=approved` 後，admin 依 `law_enforcement_request_targets`
  範圍手動或半自動（可另寫一支僅限 admin 呼叫的匯出 API，邏輯類似交付內容 2 的資料匯出但改為
  依調閱範圍查詢而非「使用者自己的全部資料」）產生匯出包，存進
  `law_enforcement_exports.storage_object_id`（`StorageKind` 建議新增
  `law_enforcement_export`，本次不動 schema，留給實作時處理）；下載連結比照交付內容 2 的
  簽名 URL，但**只有 admin 角色能取得下載連結**、且每次下載寫入
  `law_enforcement_request_events`（`action=export_downloaded`）；`status` 轉 `fulfilled`。
- **是否通知當事人**：`notify_user` 欄位**預設 `true`**（比照個資法對當事人知情權的一般精神）；
  例外（`notify_user=false`）僅限機關公文中明確載明「法院裁定不得通知」或「通知將妨礙偵查」等
  法律依據時，由核准者（法務窗口）個案認定並在 `rejection_reason`／備註欄位記錄依據——**本規格
  刻意不做自動化判斷是否該通知**，這是需要法律專業個案判斷的事，系統只提供欄位與流程支撐，
  不提供決策邏輯。
- **與 legal hold 的關係**：調閱請求核准後，建檔人應同時評估是否需要對 `request_targets` 建立
  對應的 `legal_holds`（例如案件尚未偵結前，避免當事人剛好觸發帳號刪除或 retention 清理把
  資料清掉）；本規格不強制自動連動建立（避免每個調閱請求都無條件鎖死目標資料造成過度保全），
  由核准者依案件性質判斷是否需要，這也是需要人工法律判斷的環節。

#### 7. 後台頁面（依 v1 §7 頁面地圖既有規劃，M7 前台無新增頁面，僅 `/me/settings` 加兩顆按鈕）

| 頁面 | 路徑 | 內容 |
|---|---|---|
| 資料匯出/刪除入口 | `/me/settings` | 「匯出我的資料」「刪除我的帳號」兩顆按鈕＋目前
  `privacy_requests` 狀態顯示 |
| 資料管理 | `/admin/data` | retention 政策清單與編輯（`data_retention_policies`）、
  `data_purge_logs` 查詢 |
| 法務請求 | `/admin/legal-requests` | 機關請求建檔、審核、匯出 |
| Legal Hold | `/admin/legal-holds` | 建立/解除保全，依 `target_type`/`target_id` 查詢 |

#### 8. 索引（附加於 §11.2 既有定案索引之外，不與其衝突）

```
privacy_requests(user_id, type, created_at)
privacy_requests(status, cooling_off_until)      -- 冷卻期到期掃描用
data_exports(status, expires_at)                 -- 過期清除 job 用
data_purge_logs(policy_key, created_at)
legal_hold_targets(target_type, target_id)        -- isUnderLegalHold() 核心查詢，必建
law_enforcement_request_targets(target_type, target_id)
```

### 不做（scope guard）

- **不做歐盟等級的合規**：本規格只滿足台灣個資法對應的當事人權利（查詢/複製/刪除）與保存/
  調閱基本框架，不做 GDPR「被遺忘權」的跨境法規遵循、不做 CCPA 等其他司法管轄區的合規要求。
- **不做機器可讀的國際標準匯出格式**：匯出包用清楚的中文 README + JSON，不特別遵循
  schema.org/GDPR Data Portability 的標準結構化格式。
- **不做部分刪除**：帳號刪除是「整個帳號」的操作，不支援「只刪除我的其中一則留言/一張圖片」
  這種零散請求——那些走既有的「編輯/下架物品」「刪留言」等功能（若尚未支援，屬各自 milestone
  的範圍，不在 M7）。
- **不做警方調閱的線上自助送單介面**：一律走站方既有客服/公文管道人工建檔，不開放外部帳號
  直接對 `law_enforcement_requests` 寫入。
- **不做調閱請求真偽的自動化驗證**（例如串接政府系統驗證公文字號）：本規格假設建檔的 admin
  已經用既有站務流程（電話回撥機關公開對外窗口等）人工核實來文真實性；自動化驗證超出 M7 範圍。
- **不做「刪除後可復原」的帳號刪除**：冷卻期內可撤銷，但冷卻期一過、去識別化執行完成後即為
  終局，不提供事後復原（暱稱/email 等已被覆寫，且部分覆寫是不可逆的，例如 email 佔位符）。
- **不做匯出包的訂閱式/排程式自動產生**：每次都要使用者手動觸發，不做「每月自動幫你產一份」。
- **不做 `law_enforcement_exports`/legal hold 的後台頁面搶在 M2 之前完工**：`/admin/legal-
  requests`、`/admin/legal-holds`、`/admin/data` 三個頁面依賴 M2 後台最小集的殼（導覽、
  RBAC 判斷），若 M2 尚未完成，M7 實作時需先補最基本的 admin 殼，不能假設它已存在。

### 驗收清單

- [ ] 乾淨 DB `prisma migrate deploy` 後 `privacy_requests`／`data_exports`／
      `data_retention_policies`／`data_purge_logs`／`law_enforcement_requests` 相關表組／
      `legal_holds` 相關表組皆存在；`legal_hold_targets(target_type, target_id)` 索引存在。
- [ ] 使用者觸發「匯出我的資料」→ 24 小時內第二次觸發回 409 → job 執行後 `data_exports.status`
      轉 `ready`，`storage_objects` 出現一筆 `kind=export_package` 的紀錄，站內通知送達。
- [ ] 下載匯出包：呼叫下載 API 兩次拿到的簽名 URL **不同**（驗證非固定網址）；用簽名 URL 直接
      GET 物件成功；短效期過後同一個簽名 URL 過期，直接 GET 回 403（驗證非 `publicUrl()` 那種
      永久可讀網址）。
- [ ] 匯出包內容人工檢查：含該使用者的物品、留言、直贈、交接、私訊、感謝留言、貢獻值、通知，
      不含其他使用者的私密資料（例如對話另一方的 email）。
- [ ] 7 天後（可用手動改 `expires_at` 到過去模擬）觸發過期清除 job → MinIO 物件被刪、
      `data_exports.status` 轉 `expired`、`data_purge_logs` 有對應紀錄。
- [ ] 觸發帳號刪除 → `privacy_requests.status` 為 `cooling_off`、`cooling_off_until` 為
      7 天後；冷卻期內呼叫撤銷 API → `status` 轉 `cancelled`，帳號資料不受影響。
- [ ] 冷卻期滿（手動改 `cooling_off_until` 到過去模擬）觸發執行 job → `User.name`/`email`/
      `image`、`Profile.nickname`/`bio` 依對照表改寫，`User.id` 不變；`Account`/`Session`/
      `UserRole` 真的被刪除（該帳號無法再登入）；`ClaimComment`/`ThanksMessage`/
      `HandoverRecord`/`ContributionEvent`/`Message` 等資料列**筆數不變**（直接查 DB count
      驗證刪除前後一致）。
- [ ] 對某使用者的資料建立 `legal_holds`（`target_type=user`）後觸發帳號刪除冷卻期到期執行 job
      → `isUnderLegalHold` 回傳 true、去識別化**不執行**，`privacy_requests.status` 轉
      `rejected`，使用者收到「因法律程序暫無法刪除」通知（不揭露案件細節）。
- [ ] `retention_purge` job 依 `data_retention_policies` 設定執行：改一筆政策的 `retention_days`
      後重跑 job，行為隨新設定改變（驗證政策是可設定的，不是寫死常數）；命中 legal hold 的目標
      被跳過並在 `data_purge_logs` 標記 `skipped_legal_hold=true`。
- [ ] `/admin/legal-requests` 建立一筆 `law_enforcement_requests`（`submitted_by` 與後續
      `approved_by` 為不同帳號）：非 admin 呼叫核准 API → 403；核准後可產生
      `law_enforcement_exports` 並下載，下載動作寫入 `law_enforcement_request_events`。
- [ ] `/u/[userId]` 訪問已刪除帳號的個人頁 → 顯示「已刪除的使用者」，不顯示原暱稱。
- [ ] `docs/governance/judgment-rubrics.md` §5 三組底線逐條過（比照 M1 驗收慣例）。

---

> ⚠️ **法律免責聲明（本節結尾重申）**：以上資料保留期限、去識別化範圍、legal hold 認定、警方
> 調閱流程（尤其「是否通知當事人」）均為技術實作建議，**不能替代律師意見**。M7 正式進入實作
> 之前，除了需要使用者確認本規格的技術設計，法務相關段落（交付內容 3、4、6）更需要**台灣律師
> 審閱**，兩者缺一都不應該讓 M7 上線。

---

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
- [ ] Google OAuth 品牌驗證（2026-07 查證：未驗證品牌的同意畫面只顯示網域不顯示 app 名稱）：
      Search Console 驗證網域 → Branding 頁填齊（含 /privacy 網址，依賴上一項的隱私頁）→
      Verify Branding → Publish branding。
- [ ] SEO/AEO gate（§3.7）：Lighthouse SEO ≥ 90；物品頁通過 Google Rich Results Test；
      robots.txt/sitemap.xml/llms.txt 在正式網域可存取。

## 13. 本檔維護

- 勾選進度、為 M5–M8 補細部規格：任何 session 可做（照 maintenance-protocol.md）。
- 改動已定案決策（§1 non-goals、§2 技術棧、§4 砍線、§12 gate）：**必須先問使用者**。
