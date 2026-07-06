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

## 8a. M8 — 營運強化（v1.4，細部規格）

**目標**：站長目前只有一人、沒有維運團隊，正式站出事時（慢、掛、通知送不出去、storage 爆量）
不能只靠「肉眼看 log」。M8 補齊最小可用的維運工具：storage 用量看得見、慢查詢抓得到、
備份還原真的演練過而不是紙上談兵、健康狀態有歷史紀錄可查、通知失敗會自動重送而不是石沉大海。
**依賴**：M0（既有 `/api/health` route、MinIO 接通、`storage_objects` 表與孤兒檔清理 job）、
M2（`/admin` 後台最小集——本規格的儀表板頁面掛在其下，不新開一個獨立 admin 系統）、
M3（`system_jobs`／`system_job_runs` 排程觸發＋idempotent 執行機制——本規格新增數個 job key
掛在同一套機制上，不重新發明）、M4（`notification_deliveries`——本規格的通知失敗重送直接操作
這張既有表；`telegram_accounts.isActive`／`unlinkedAt`——失效自動解綁邏輯掛在這裡）。

### 交付內容

1. **資料表與欄位**（表名依 §11.1 定案：`health_checks`、`error_logs`、`performance_metrics`、
   `storage_usage_snapshots`，不可更改；以下欄位為本規格新增設計，命名依 §3.1 慣例）。

   `health_checks`（每次檢查、每個子系統各寫一筆，累積歷史紀錄）：
   ```
   id
   subsystem   text            -- 字串 key（比照 NotificationPreference.eventType 的慣例，不用
                                  enum，未來加子系統不必 migration）："database" | "storage" |
                                  "background_jobs"
   status      text            -- "up" | "degraded" | "down"
   latencyMs   int, nullable   -- 該次檢查耗時，例如 DB `SELECT 1`、MinIO headBucket 的往返時間
   detail      jsonb, nullable -- 例如 background_jobs 子系統記錄「距離上次 system_job_runs
                                  成功結束幾分鐘」「近 N 次執行是否有 failed」
   checkedAt   timestamptz (= createdAt)
   ```
   索引：`health_checks(subsystem, checkedAt)`（儀表板依子系統畫歷史趨勢用）。

   `error_logs`（記錄「壞事發生」——與 `performance_metrics` 的分工見下方交付內容 3）：
   ```
   id
   source      text            -- "api" | "background_job" | "webhook"
   routeOrJob  text, nullable  -- 正規化後的 route path（例如 "/api/items/[id]/claims"，不含
                                  動態 id）或 system_jobs.key
   message     text
   stack       text, nullable
   context     jsonb, nullable -- userId、requestId 等排查用途；**禁止**塞入 §1 列出的敏感個資
   occurredAt  timestamptz (= createdAt)
   ```
   索引：`error_logs(source, occurredAt)`。

   `performance_metrics`（記錄「正常運作但耗時多少」，不論成功失敗，見下方交付內容 3）：
   ```
   id
   metricType  text     -- 先只做 "db_query"，"api_request" 留給之後擴充（例如量測整個 route
                            handler 耗時），本規格不實作 api_request
   label       text     -- 正規化後的識別碼（例如 "Item.findMany"、"ClaimComment.create"），
                            不含動態 id，方便依 label 分組統計
   durationMs  int
   isSlow      boolean  -- durationMs > 1000（見下方判定門檻）；即時旗標，不是統計量，P95 由
                            查詢時對原始樣本即時聚合算出（見下方，不另建彙總表）
   context     jsonb, nullable
   recordedAt  timestamptz (= createdAt)
   ```
   索引：`performance_metrics(metricType, label, recordedAt)`（依 label 分組看趨勢）、
   `performance_metrics(isSlow, recordedAt)`（儀表板快速撈「最近的慢查詢」列表）。

   `storage_usage_snapshots`（每日快照，一次快照對每個 bucket 各寫一筆）：
   ```
   id
   bucket         text
   totalBytes     bigint
   objectCount    int
   orphanedBytes  bigint, nullable  -- 「孤兒用量」定義見下方交付內容 2，**不是**
                                       `storage_objects.status='pending'` 那種（那種已有 M0 既有
                                       的每日孤兒檔清理 job 在處理，見 §5 交付內容 6）
   orphanedCount  int, nullable
   byItemStatus   jsonb, nullable   -- 例如 `{"published": 12345678, "removed_by_moderator":
                                       234000, "expired": 88000}`，依物品狀態分類的 bytes 加總
   snapshotAt     timestamptz (= createdAt)
   ```
   索引：`storage_usage_snapshots(bucket, snapshotAt)`。

2. **Storage 用量儀表板**：
   - **快照頻率**：每日一次，沿用 M3 建立的排程觸發機制（`system_jobs` key =
     `"storage_usage_snapshot"`，透過同一套 `CRON_SECRET` 保護 route 觸發；實際 cron
     基礎設施仍是 M3 決議的 Cronicle／Crontab UI／cron-job.org／GitHub Actions 三選一，M8
     只是在同一套機制上多掛一個 job，不重新選型）。
   - **「孤兒用量」精確定義**：`storage_objects.status` 仍是 `linked`（已被 `item_images`
     引用，不會被 M0 既有的每日孤兒檔清理 job 動到——那支 job 只處理 `status='pending'`
     的「上傳了但從未被引用」的檔案），但透過 `item_images → items` 反查，該 `items.status`
     已經是終態（`removed_by_user`、`removed_by_moderator`、`expired`）——這批圖片持續佔用
     MinIO 空間卻沒有任何既有機制在清理，是 M0 孤兒檔清理範圍的盲區。**M8 快照 job 只負責
     量測並在儀表板呈現**，不在本規格內新增自動清理（要不要清、要保留幾天當「反悔期」——
     例如物品被強制下架後物主申訴成功要復原——是後續規格範圍或使用者決策，見「不做」）。
   - **追蹤維度**：MinIO 總用量（依 bucket，呼叫既有圖片管線用的 S3 client 做
     `ListObjectsV2` 加總 `sizeBytes` 與物件數）；依物品狀態分類的用量（`byItemStatus`，
     資料來源是 DB 內 `storage_objects.sizeBytes` 依 `item_images → items.status` join
     加總，**不必**額外呼叫 MinIO API——**注意 `ItemImage` 同時有 `thumbObjectId` 與
     `mediumObjectId` 兩個各自指向不同 `StorageObject` 列的外鍵，join／加總時必須把這兩條關聯
     都算進去（例如分別對 `thumbObject`／`mediumObject` 各 join 一次再加總，或用一次查詢把
     `item_images` 的兩個 FK 都攤平成列再加總），只算其中一個會漏算一半用量**）；孤兒用量
     （`orphanedBytes`／`orphanedCount`，同一組 join 篩出終態物品的部分，同樣要處理雙 FK）。
   - **一致性交叉驗證**：同一次快照裡，「DB 加總的 `sizeBytes`」與「MinIO `ListObjectsV2`
     實際加總」兩者的 bucket 總量若對不上（誤差超過例如 1%），代表資料有落差（可能是某次
     上傳失敗但 DB 紀錄殘留、或 MinIO 端手動動過檔案），本身就該寫成一筆 `error_logs`
     （`source="background_job"`、`routeOrJob="storage_usage_snapshot"`）讓 admin 注意，
     不需要因此讓整個快照 job 失敗。
   - **儀表板頁面**：`/admin/ops`（見交付內容 7）的 storage 分頁，呈現目前總用量、依
     bucket／物品狀態分類的數字、孤兒用量特別標示（帶「待清理」提示）、以及
     `storage_usage_snapshots` 歷史趨勢（用量隨時間變化）。

3. **慢查詢紀錄**：
   - **`error_logs` 與 `performance_metrics` 分工**：`error_logs` 記錄「壞事發生」——API
     未捕捉例外、background job 執行失敗、webhook 驗證失敗，用途是除錯與異常追蹤；
     `performance_metrics` 記錄「耗時多少」——不論成功或失敗都可以記，用途是效能分析與趨勢。
     兩者不互斥：一個查詢逾時最終丟例外的情境，理論上兩邊各記一筆——`performance_metrics`
     記下它跑了多久才失敗、`error_logs` 記下它為什麼失敗。
   - **判定門檻**：呼應 §12 上線前檢查表「壓測煙霧測試：500 物品/50 使用者假資料下列表與查詢
     P95 < 1s」，慢查詢定義為**單一 label 的 P95 > 1s**。P95 是統計量、不能對單一次呼叫即時
     判定，所以拆成兩層：`isSlow` 欄位是**即時旗標**（單次 `durationMs > 1000` 就標記，
     用於快速找出「這一筆特別慢」的個案）；真正的 P95 則由儀表板查詢時對 `performance_metrics`
     原始樣本用 PostgreSQL 內建的 `percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)`
     即時聚合算出（依 `label` 分組、依時間窗篩選，例如「過去 24 小時」），**不另建彙總表**——
     原始樣本已經夠用，多維護一張彙總表只會多一份需要保持一致的衍生資料，MVP 不需要。
   - **擷取機制選型：Prisma Client Extension（`$extends` 的 query 元件）而非
     `pg_stat_statements`**。理由：
     (a) 本專案用 Prisma 7，`$use` middleware 已在 Prisma 5 移除，`$extends` 是現行推薦做法，
     與既有 `src/lib/db.ts`（`PrismaPg` adapter）完全相容，不需要額外依賴；
     (b) `pg_stat_statements` 是 PostgreSQL extension，需要資料庫層級 `CREATE EXTENSION`
     權限——Zeabur 的 managed PostgreSQL 服務**是否開放這個權限尚未查證**，屬外部依賴風險，
     若屆時發現不可行會卡住整個功能；`$extends` 完全在應用層控制，不依賴平台權限，MVP 階段
     風險更低；
     (c) 取捨：`$extends` 量到的是「ORM 邊界的 wall time」（含網路往返），拿不到查詢計畫、
     buffer 命中率等資料庫內部指標，若之後真的要深入診斷「為什麼慢」（而不只是「知道慢」），
     `pg_stat_statements`（如果平台允許）或手動 `EXPLAIN ANALYZE` 仍是更好的**調查工具**——
     但那是排查手段，不是儀表板的常態資料源，M8 儀表板的目的只是「知道慢，知道多慢，知道是
     哪一類查詢」，不需要為了這個目的追求資料庫內部深度。
   - **取樣範圍：全量記錄，不設寫入門檻**——曾經考慮「只記錄 `durationMs > 100ms` 的查詢」濾掉
     健康查詢雜訊，但這個設計有統計學上的缺陷：`percentile_cont(0.95)` 是對**樣本庫**算百分位，
     如果樣本庫本身就先過濾掉佔絕大多數的快查詢（5ms、10ms 這類），算出來的「P95」實際上會變成
     「大於 100ms 的查詢裡的 P95」，嚴重偏高、無法反映真實效能，也無法驗證 §12「全體查詢
     P95 < 1s」這個目標。MVP 階段流量不大，直接記錄全部查詢即可，資料量交給下面的「資料量控制」
     （30 天保留期清理 job）處理，不做抽樣或門檻篩選。`error_logs` 同樣不受限，所有錯誤一律記錄。
   - **資料量控制**：見交付內容 8 的保留期清理 job（`performance_metrics` 30 天、`error_logs`
     90 天、`health_checks` 30 天；`storage_usage_snapshots` 資料量小且需要長期趨勢，不設
     保留期）。
   - 數值集中管理：慢查詢門檻（1000ms 即時旗標）、保留天數等數值，實作時
     集中放進一個 config 檔（比照 M1 `src/lib/contribution.ts`「數值進 config 不寫死」的慣例），
     不要分散寫死在各處。

4. **備份還原演練（規格化為例行工作）**：
   - **頻率**：每季一次（quarterly）例行演練；另外任何一次 schema 有重大變更（新增/修改核心表）
     後，也要額外加演練一次（觸發式，不算進季度例行的計數）；任何一次因真實事故而執行的還原，
     視同已完成當季演練，補寫紀錄即可不必再另外重演一次。
   - **Runbook 檔案**：`docs/runbooks/backup-restore.md`（M8 實作時建立；本規格只定義它必須
     包含的章節，這次規格 PR 依任務限制不建立該檔案本身）。必須包含：
     1. **PostgreSQL 備份**：用 `pg_dump` 透過 `DATABASE_URL` 的對外連線字串執行
        `pg_dump "$DATABASE_URL" -F c -f sharegood_$(date +%Y%m%d).dump`，由 admin 手動於
        自己機器執行並下載保存（備份副本離開 Zeabur 主機本身，這是「資料要有異地副本」的
        底線，與「不做多區域備援」的 scope guard 不衝突——後者講的是**服務**層級的容錯
        failover，這裡只是**資料**要有一份不在同一台主機上的副本，是不同層次的規格）。
     2. **PostgreSQL 還原**：`pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL"
        sharegood_YYYYMMDD.dump`；還原後驗證步驟：跑 `prisma migrate status` 確認 migration
        對齊、跑幾條基本 `COUNT(*)` 確認關鍵表筆數與備份當下相符。
     3. **MinIO 資料備份**：用 `mc mirror sharegood-minio/<bucket> ./minio-backup-YYYYMMDD/`
        鏡像到本地磁碟或第二個 S3 相容目的地；還原時反向 `mc mirror` 回去。
     4. **演練紀錄**：另建 `docs/runbooks/backup-drill-log.md`，每次演練追加一列（日期、
        操作者、耗時、是否成功、遇到的問題與解法），格式為表格，方便日後稽核「真的有定期
        演練」而不是紙上流程。
   - 這條直接把 §12 上線前檢查表「備份：至少手動備份 runbook 寫好並實際演練還原一次」從
     「上線前做一次」升級為「上線後仍要定期重做」的例行工作。

5. **健康檢查儀表板**：
   - **`health_checks` 與既有 `/api/health` 的關係**：M0 的 `/api/health`（`src/app/api/health/
     route.ts`）目前只檢查 DB（`SELECT 1`），本規格把它擴充為分別檢查三個子系統——
     `database`（既有邏輯不變）、`storage`（呼叫 MinIO 既有圖片管線用的 S3 client 做
     `headBucket` 或輕量 `listBuckets`）、`background_jobs`（查 `system_job_runs` 最近一筆
     的 `status` 與 `finishedAt`，判斷「有沒有 job 卡住很久沒跑」或「最近連續 failed」）；
     每個子系統獨立回報 up/degraded/down，一個子系統掛掉不影響其他子系統的判定（例如 MinIO
     斷線時 `database` 仍應正常回報 up）。**儀表板就是把這三個子系統的檢查結果視覺化＋存
     歷史紀錄**：每次呼叫 `/api/health`（不論是外部監控平台打的，還是下面的定期 job）都把
     三個子系統的結果各寫一筆進 `health_checks`。
   - **定期探測**：`/api/health` 本身仍是 on-demand（給外部監控或 Zeabur 平台自己的健康檢查
     呼叫），但外部呼叫頻率不受我們控制，也可能被平台用不穩定的頻率打，導致歷史資料時間間隔
     不均勻。因此另加一個排程 job（`system_jobs` key = `"health_check_probe"`，建議每 5
     分鐘一次）主動呼叫**同一套內部檢查函式**（不透過 HTTP 自打自己，避免不必要的網路
     overhead 與潛在的循環依賴），確保 `health_checks` 有穩定、可預期的取樣頻率。
   - **儀表板頁面**：`/admin/ops`（見交付內容 7）的總覽分頁，呈現三個子系統目前狀態（紅黃綠）
     與過去 24 小時／7 天的歷史趨勢；`background_jobs` 子系統異常時列出是哪個 `system_jobs.key`
     出問題，方便直接對應到 M3/M4/M8 各自的 job。

6. **通知失敗重送**：
   - **失敗判定**：呼叫 Telegram API 回傳非 2xx，或呼叫逾時（例如 5 秒）未回應，即判定失敗——
     對應的 `notification_deliveries` 列寫入 `status="failed"`、`attempts += 1`、
     `lastError` 記下錯誤訊息或逾時原因。
   - **重送策略：指數退避**。第 N 次重試前需等待 `min(2^N × 60, 3600)` 秒（第 1 次失敗後
     等 2 分鐘、第 2 次 4 分鐘、第 3 次 8 分鐘……上限封頂 60 分鐘），由重送 job（`system_jobs`
     key = `"notification_retry"`，建議每 5–10 分鐘跑一次）判斷「這筆 delivery 現在該不該
     重試」。**Schema 補充需求**：現有 `notification_deliveries`（M4 schema）欄位
     `attempts`／`lastError`／`sentAt`／`status` 不足以算出「距離上次嘗試過了多久」——
     `sentAt` 語意是「成功送達時間」，重試中的失敗紀錄這欄是 null；本規格因此需要新增一個
     `lastAttemptAt`（timestamptz）欄位記錄「最近一次嘗試（不論成功失敗）的時間」，用它加上
     `attempts` 算出的退避秒數來判斷是否已到重試時機。若 M4 的 schema 分支合併時尚未包含這個
     欄位，實作 M4 時應一併加入；若 M4 已經先合併定案，M8 實作時再補一支小 migration 加這個
     欄位（只新增欄位，不影響 M4 既有邏輯）。
   - **最大重試次數**：5 次。達到上限後 `status` 維持 `failed`、不再被重送 job 挑中
     （條件式查詢排除 `attempts >= 5`），並且要「標記給 admin 看」——不需要為此另建表，
     `/admin/ops` 的通知分頁（見交付內容 7）直接查詢
     `notification_deliveries WHERE status='failed' AND attempts >= 5` 即可列出。
   - **失效自動解綁**（對應 M4 規格既有的「發送失敗重試＋失效自動解綁」一句話，本規格是把它
     具體落地）：重送 job 每次執行時，若某個 `telegram_accounts` 底下最近連續（例如最近 3 筆）
     的 `notification_deliveries` 都是 `failed` 且錯誤訊息符合「帳號已失效」特徵（例如
     Telegram API 回傳 403 `bot was blocked by the user` 或 chat not found），代表使用者已經
     封鎖 bot 或刪除對話，此時把該 `telegram_accounts.isActive` 設為 `false`、寫入
     `unlinkedAt=now()`，之後不再嘗試對這個帳號送 Telegram 通知（站內通知不受影響，照常寫入）。

7. **`/admin` 後台整合**：新增 `/admin/ops` 頁面（依賴 M2 admin 後台最小集的 RBAC 與版面骨架，
   本規格只是在其下新增頁面，不新建獨立系統；非 admin/moderator 存取一律 403，沿用 M2 既有
   權限檢查 helper）。分頁：
   - **總覽**：三個子系統健康狀態＋歷史趨勢（交付內容 5）。
   - **Storage**：用量儀表板（交付內容 2）。
   - **慢查詢**：依 label 列出 P95、最近的慢查詢個案列表、`error_logs` 最新錯誤列表。
   - **通知**：重送中／已達重試上限的 `notification_deliveries` 列表（交付內容 6）。

8. **保留期清理 job**：`system_jobs` key = `"ops_retention_cleanup"`，每日執行一次，同時清理
   `performance_metrics`（`recordedAt` 超過 30 天）、`error_logs`（`occurredAt` 超過 90 天）、
   `health_checks`（`checkedAt` 超過 30 天）——三張表都是「僅供近期診斷用的高頻寫入表」，用
   同一個 job 內聚處理，不必為此各自開一個 job key 增加 `system_jobs` 管理負擔；
   `storage_usage_snapshots` 不在此 job 範圍內（見交付內容 3，不設保留期）。**必須分批刪除，
   不能對這三張高頻表各自下一句單一的 `DELETE ... WHERE <時間欄位> < cutoff`**：這幾張表
   跑一段時間後過期資料量可能很大，單一大型 DELETE 會長時間鎖表、WAL 暴增，影響線上即時寫入
   與查詢。實作上對每張表迴圈執行「`DELETE ... WHERE id IN (SELECT id FROM <table> WHERE
   <時間欄位> < cutoff LIMIT 5000)`，直到某次刪除筆數為 0」，每批次之間可以有意的短暫停頓
   （例如數十毫秒）讓其他查詢有機會插隊，避免長時間佔用連線與鎖。

9. **本規格新增的 `system_jobs` key 總覽**（附加於 M3/M4 既有 job 之外）：

   | job key | 頻率 | 用途 |
   |---|---|---|
   | `storage_usage_snapshot` | 每日 | 交付內容 2 |
   | `health_check_probe` | 每 5 分鐘 | 交付內容 5 |
   | `notification_retry` | 每 5–10 分鐘 | 交付內容 6 |
   | `ops_retention_cleanup` | 每日 | 交付內容 8 |

10. **索引**（附加於 §11.2 既有定案索引之外，不與其衝突）：
    ```
    health_checks(subsystem, checked_at)
    error_logs(source, occurred_at)
    performance_metrics(metric_type, label, recorded_at)
    performance_metrics(is_slow, recorded_at)
    storage_usage_snapshots(bucket, snapshot_at)
    ```

### 不做（scope guard）

- **不做自動化 auto-scaling**：Zeabur Free/單一方案的 MVP 規模不需要；出現容量問題先靠
  storage 儀表板與慢查詢紀錄人工判斷再決定是否升級方案。
- **不做多區域備援**：單一 Zeabur 部署，不做跨區域/跨雲的服務層 failover；備份演練（交付內容 4）
  只保證「資料有異地副本、還原得回來」，不保證「服務不中斷」，兩者是不同層次的規格，此處刻意
  只做前者。
- **不做即時告警（alerting/pager）**：`health_checks`／`error_logs` 只是儀表板，不做
  email/簡訊/Slack 等主動告警通知 admin；MVP 階段站長需要手動看 `/admin/ops`。若之後真的需要
  主動告警，屬於獨立提案，不在 M8 範圍。
- **不做對外公開的 status page**：儀表板只給 admin 看，不做類似 status.sharegood.app 這種公開
  可用性頁面。
- **不做 `pg_stat_statements`**：見交付內容 3 的選型理由，MVP 階段不引入資料庫層級 extension；
  若之後證實 Zeabur 平台允許且確實需要更深的查詢診斷，屬於未來版本的獨立提案。
- **不做效能自動優化**：不做自動建議加索引、自動重寫查詢等機制；`performance_metrics` 只負責
  量測與呈現，優化動作仍由工程師人工判斷執行。
- **不做 storage 孤兒用量自動清理**：交付內容 2 的「孤兒用量」只量測與呈現，不自動刪除 MinIO
  檔案；是否清理、保留多久當「反悔期」，留給之後的獨立規格或使用者決策。
- **不做全鏈路 tracing（APM/OpenTelemetry 等）**：本規格的 `performance_metrics` 只是應用層
  簡易記錄，不是分散式追蹤系統；ShareGood 是 monolith，暫無跨服務追蹤的需求。

### 驗收清單

- [ ] 乾淨 DB 跑 `prisma migrate deploy` 後，`health_checks`／`error_logs`／
      `performance_metrics`／`storage_usage_snapshots` 四張表皆存在，交付內容 10 的索引皆已建立；
      直接查 DB schema 確認。
- [ ] 手動觸發 `storage_usage_snapshot` job：`storage_usage_snapshots` 新增一筆，`totalBytes`
      與依 bucket 分類的數字正確；故意製造一個「物品已下架但圖片未清」的測試情境（把某個測試
      物品轉 `removed_by_moderator` 但不動它的 `item_images`），`orphanedBytes`／`orphanedCount`
      正確抓到這筆用量；同一次快照若人為製造 DB 與 MinIO 用量不一致，`error_logs` 出現對應紀錄。
- [ ] 故意執行一個耗時 > 1 秒的查詢（測試用途，例如故意不用索引的大表 join），
      `performance_metrics` 出現一筆 `isSlow=true` 的紀錄；對該 `label` 用
      `percentile_cont(0.95)` SQL 撈出的 P95 數值與手動計算相符。
- [ ] 故意讓一支 API 丟出未捕捉例外，`error_logs` 出現對應紀錄，`message`／`stack` 完整、
      不含敏感個資。
- [ ] 手動觸發一次備份演練：照 `docs/runbooks/backup-restore.md` 步驟，`pg_dump` 出檔 →
      在一個乾淨環境（例如另一個測試用 PostgreSQL 實例）`pg_restore` 成功 → `prisma migrate
      status` 確認對齊 → 關鍵表筆數與備份當下相符；同一次也用 `mc mirror` 驗證 MinIO 圖片可
      還原；演練結果寫入 `docs/runbooks/backup-drill-log.md`。
- [ ] `/api/health` 擴充後同時回報 `database`／`storage`／`background_jobs` 三個子系統狀態；
      刻意讓 MinIO 斷線（改錯 endpoint 或關掉服務）時，`storage` 回報 `down` 而
      `database` 不受影響仍回報 `up`。
- [ ] `health_check_probe` job 每次執行都在 `health_checks` 寫入三筆（各子系統一筆）。
- [ ] 通知重送：故意讓 Telegram API 呼叫失敗（mock 或斷網），對應 `notification_deliveries`
      轉 `failed`、`attempts+1`；`notification_retry` job 依指數退避規則，在正確的時間窗口
      內才再次嘗試（提早觸發 job 驗證「還沒到重試時間，不重試」；把 `lastAttemptAt` 人為撥到
      退避時間之前驗證「到時間了，重試」）；達到 `attempts>=5` 後不再被重送 job 挑中，且在
      `/admin/ops` 通知分頁看得到這筆。
- [ ] 連續 3 次失敗且錯誤訊息符合「帳號已失效」特徵的 `telegram_accounts`，重送 job 執行後
      `isActive` 轉 `false` 且 `unlinkedAt` 有值，之後不再嘗試對其送 Telegram 通知。
- [ ] `/admin/ops` 四個分頁（總覽／Storage／慢查詢／通知）皆能正常呈現資料；非
      admin/moderator 帳號存取 `/admin/ops` 或其對應 API → 403。
- [ ] `ops_retention_cleanup` job 執行後，`performance_metrics`（30 天）／`error_logs`
      （90 天）／`health_checks`（30 天）超過保留期的資料被清除；`storage_usage_snapshots`
      不受影響、持續累積不清除。
- [ ] `docs/governance/judgment-rubrics.md` §5 三組底線逐條過（比照 M0–M5 驗收慣例）。

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
