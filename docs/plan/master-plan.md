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
- [x] E2E 主迴路測試綠（兩個測試帳號全流程）。`e2e/tests/main-loop.spec.ts`（Playwright，
      database session 直接插 cookie 登入；上架用真的 API 呼叫因本機無 MinIO，其餘每步
      都是真的瀏覽器操作）。
- [x] 併發驗證：兩個請求同時搶「先到先得」→ 恰好一人成功（寫整合測試用 `Promise.all` 打同一端點）。
      `e2e/integration/concurrency.test.ts` 改成 10 個並發請求（本機低延遲環境下兩個請求
      幾乎必定被第一層預先讀取擋成 409，測不到 transaction 內 updateMany 那層 race，見
      `docs/governance/lessons/20260706-*`），核心不變量「恰好一人 accepted」逐次驗證通過。
- [x] 重複留言被 409 擋下；B 無法接受/編輯 A 的物品（403，用直贈邀請這個等效的物主專屬操作代替，
      因為專案目前沒有通用的 `PATCH /api/items/[id]` 編輯端點）；未登入留言 401。
      `e2e/integration/permissions.test.ts`。
- [x] 非交接雙方的第三人讀取該 conversation → 404/403（實際回 404，見該 route 註解）。
- [x] 列表在假資料量下分頁正常、查詢用到索引（`EXPLAIN` 確認無 seq scan on items 主查詢）。
      補上 `GET /api/items`（先前 PR 沒做，首頁至今仍是 `DEMO_ITEMS` 示範資料，是遺留缺口，
      見 CLAUDE.md）；為了讓 EXPLAIN 真的選到 Index Scan（500 筆對本機 Postgres 太小，
      planner 幾乎必定選 Seq Scan——這是資料庫本身的正常行為，不是索引沒生效），改用 20,000
      筆假資料，`e2e/integration/pagination.test.ts`。
- [x] SEO：`curl` 物品詳情頁（無 JS）看得到標題與描述文字；頁面含 Product JSON-LD；
      `/sitemap.xml` 列出 published 物品。`e2e/integration/seo.test.ts` ＋人工 curl 驗證。
- [x] judgment-rubrics §5 三組底線逐條過（見 PR 說明）。

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

M5 已依照上面的要求產出細部規格，見緊接在下面的 §5a（格式比照 M0–M4）；**這份細部規格需經使用者
確認後才能進入實作**。M6–M8 仍維持粗綱，比照本節開工前的原則，各自開工前再產出。

## 5a. M5 — 抽籤（v1.1，細部規格）

**目標**：物品分享者除了「留言先到先得」與「直贈」之外，多一個對高需求物品更公平的選人方式——
抽籤：所有想要的人在截止前報名，到期由系統以 crypto 級亂數公平抽出 1 位得獎人；得獎人 48 小時內
需確認，逾時或婉拒則自動遞補下一位，直到有人確認或候補名單用盡；全程可事後重演驗證、可稽核。
**依賴**：M1（核心共享主迴路：`items` 狀態機、`handover_records` 交接流程、`contribution_events`
貢獻值計分、`notifications` 站內通知——本規格全部沿用既有機制，不新增也不修改這些既有 API）、
M3（`system_jobs`／`system_job_runs` 排程觸發＋idempotent 執行機制——本規格新增一個 job kind
掛在同一套機制上，不重新發明）。

### 交付內容

1. **資料表與欄位**（表名依 §11.1 定案：`lotteries`、`lottery_entries`、`lottery_results`、
   `lottery_audit_logs`，不可更改；以下欄位為本規格新增設計，命名依 §3.1 慣例）。

   `lotteries`（每個物品最多一筆，`item_id` 加 `@unique`）：
   ```
   id                 cuid
   item_id            FK → items.id，@unique（一物品終身最多一次抽籤，見下方「不做多輪抽籤」）
   creator_id         FK → users.id（＝物品 owner_id，冗余存一份方便查詢）
   entry_deadline     timestamptz     -- 報名截止時間，建立時指定，建立後不可修改
   status             LotteryStatus   -- 見下方狀態機
   seed               text, nullable  -- 開獎當下才寫入，crypto.randomBytes(32).toString('hex')
   entry_snapshot     jsonb, nullable -- 開獎當下的名單快照（canonical 排序後的 entry id 陣列）
   algo_version       text, nullable  -- 例如 "hmac-sha256-fisher-yates-v1"，供未來換算法時舊資料仍可重演
   drawn_at           timestamptz, nullable
   current_rank       int, nullable   -- 目前正等待確認的順位（指向 lottery_results.rank）
   completed_at       timestamptz, nullable
   created_at / updated_at
   ```

   `lottery_entries`（報名記錄；unique 索引依 §11.2 定案）：
   ```
   id
   lottery_id   FK
   user_id      FK
   status       entered | cancelled   -- 見下方「報名與取消」
   entered_at   timestamptz (= createdAt)
   cancelled_at timestamptz, nullable
   @@unique([lottery_id, user_id])    -- §11.2 定案索引，不可更改
   ```

   `lottery_results`（開獎後的排名與每個順位的確認狀態，一抽籤多筆，一 rank 一筆）：
   ```
   id
   lottery_id       FK
   entry_id         FK → lottery_entries.id
   user_id          冗余（方便查詢不必 join entries）
   rank             int             -- 1 = 首獎，2 = 第一順位遞補，以此類推
   status           LotteryResultStatus  -- pending / offered / confirmed / expired / declined
   offered_at       timestamptz, nullable
   confirm_deadline timestamptz, nullable  -- = offered_at + 48h
   responded_at     timestamptz, nullable  -- confirmed 或 declined 的時間
   created_at
   @@unique([lottery_id, rank])
   @@unique([lottery_id, entry_id])
   ```

   `lottery_audit_logs`（append-only，全生命週期每個狀態轉換都寫一筆）：
   ```
   id
   lottery_id
   action     text  -- entry_created / entry_cancelled / draw_started / draw_completed /
                     -- draw_failed_no_entries / rank_offered / rank_confirmed / rank_expired /
                     -- rank_declined / lottery_cancelled / item_reserved
   actor_id   FK → users.id, nullable（系統排程觸發時為 null）
   metadata   jsonb, nullable
   created_at
   ```

   **狀態機設計決策與理由**：`lotteries` 需要自己的顯式 `status` 欄位，不能完全靠
   `entry_deadline`/`drawn_at` 時間戳推導，原因有二：(a) 開獎 job 的「防重複執行」用的就是
   `status` 欄位本身當樂觀鎖（`UPDATE lotteries SET status='drawing' WHERE id=$1 AND status='open'`，
   0 rows affected＝已被別的執行搶走，直接 no-op），時間戳無法提供這種原子鎖語意；
   (b) 遞補鏈（見交付內容 5）需要追蹤「現在輪到第幾順位」這種會隨時間推進、且推進動作本身要防重複
   的狀態，純粹用時間戳反推「現在該輪到誰」在有多次遞補後會變得脆弱且難以審計。
   ```
   LotteryStatus:
     open                  -- 報名中，entry_deadline 未到
     drawing               -- 開獎 job 正在處理（極短暫的鎖定態，正常情況下人類看不太到）
     awaiting_confirmation -- 已產生排名，目前 current_rank 那位正在等待確認或已進入遞補流程
     completed             -- 有人確認中選，items.status 已轉 reserved
     failed_no_entries     -- 截止時零報名，或所有候補都逾時/婉拒用盡，抽籤失敗
     cancelled             -- 物主在開獎前主動取消

   LotteryResultStatus（每個 rank 各自的狀態）:
     pending    -- 尚未輪到
     offered    -- 目前正輪到此人，48h 倒數中
     confirmed  -- 最終贏家（一個 lottery 最多一筆是這個狀態）
     expired    -- 輪到過但 48h 內未回應，已遞補下一位
     declined   -- 輪到過但本人主動婉拒，已遞補下一位
   ```
   這與 v1 舊規格（`original-master-plan-v1.md` §9.4）把 `lottery_open`/`lottery_closed`/
   `lottery_drawn` 等狀態直接塞進 `items` 狀態機、讓 `items.status` 膨脹到 9 態的做法不同
   （§4 決策 1 提到的「狀態機 9 態」指的正是 v1 這個舊設計）。本規格刻意把抽籤特有的複雜度
   完全封裝在 `lotteries.status`（6 態）與 `lottery_results.status`（5 態）這兩個獨立狀態機裡，
   `items.status`（M1 定案的 enum）**完全不新增值**，物品在抽籤開放報名、開獎、確認期間全程
   維持 `published`，只有在最終有人 `confirmed` 的那一刻才轉一次 `reserved`（見交付內容 2）。
   這與 M1 把物品狀態機盡量簡化的精神一致。

2. **與 M1 物品狀態機的整合**：`items.status` 不新增任何狀態；物品進入抽籤模式後在
   `entry_deadline` 前、開獎中、確認/遞補期間全程維持 `published`，UI 靠 join `lotteries` 表
   （用 `item_id` 的 unique 索引，查詢成本可忽略）判斷目前是否處於抽籤流程、進度到哪。
   只有在某個 `lottery_results` 列被 `confirm`（見交付內容 6）的同一個 transaction 裡，才把
   `items.status` 轉為 `reserved`，之後完全銜接既有 M1 交接流程
   （`POST /api/items/[id]/handover/ensure`、`/conversations/[id]`、
   `PATCH /api/handover/[id]/complete`、`PATCH /api/handover/[id]/no-show`）——**這些既有 API
   不需要也不應該為了抽籤修改任何一行**，因為它們的介面本來就只認 `items.status`，不管配對是
   怎麼促成的。若最終 `failed_no_entries`，`items.status` 保持/停留在 `published`（它從未離開過
   `published`，不需要「退回」動作），之後可正常被留言或直贈。
   **併發防呆**：只要該物品存在一筆非終態的 `lotteries`（`status` 為 `open`/`drawing`/
   `awaiting_confirmation`），既有 M1 的 `POST /api/items/[id]/claims`（留言）與
   `POST /api/items/[id]/direct-shares`（直贈）**必須在 server-side 加一個檢查**，命中就回 409
   （`{"error":{"code":"CONFLICT","message":"物品目前為抽籤模式，無法留言/直贈"}}`），避免三種
   選人方式互相打架。`lotteries.status` 進入 `completed`/`failed_no_entries`/`cancelled` 之後，
   這個檢查自然放行（`completed` 時 `items.status` 已經是 `reserved`，M1 既有邏輯本來就會擋；
   `failed_no_entries`/`cancelled` 時物品回到單純 `published`，留言與直贈正常可用）。

3. **報名與取消報名 API**：
   - `POST /api/items/[id]/lottery`：物主為自己名下 `draft`/`published` 且尚未有 `lotteries` 列
     的物品建立抽籤，body 帶 `entryDeadline`；建立後 `entryDeadline` **不可修改**（見下方「已知
     取捨」）。
   - `GET /api/items/[id]/lottery`：回傳目前狀態、報名截止時間、目前總報名人數（**不揭露其他
     報名者身份**，只回自己是否已報名、以及自己若中選/遞補中則回自己的 rank 與 `confirmDeadline`）。
   - `POST /api/items/[id]/lottery/entries`：登入使用者報名；僅允許 `lotteries.status='open'`
     且未過 `entryDeadline`；重複報名靠 `@@unique([lottery_id, user_id])` 擋下回 409。
   - `DELETE /api/items/[id]/lottery/entries`：取消報名；僅允許 `lotteries.status='open'` 時；
     取消後 `status` 轉為 `cancelled`。若使用者想重新報名，由於 `(lottery_id, user_id)` 的唯一性
     約束，實作上「重新報名」等同於把既有那一列的 `status` 從 `cancelled` 改回 `entered` 並更新
     `entered_at`，而不是新增一列。此設計等同「截止前可以取消也可以再報名，但不可能有兩筆同時
     有效」的直覺行為。
   - `PATCH /api/lotteries/[id]/cancel`：物主取消整個抽籤；僅限 `status='open'` 時可取消（已開獎
     後不可取消，因為已經產生排名與時效性承諾，貿然取消對正在等待確認的候選人不公平）；非物主
     403，`status≠open` 時 409。取消後該物品**永久失去抽籤資格**（見下方「已知取捨」），但仍可
     正常留言或直贈。

4. **開獎演算法（crypto 級 + 可重演驗證）**：
   - **產生亂數種子**：開獎當下用 `crypto.randomBytes(32).toString('hex')` 產生 `seed`，這是
     Node.js `crypto` 模組的 CSPRNG，滿足「亂數用 crypto 級」。
   - **為什麼不直接對每個位置呼叫 `crypto.randomInt()`**：`crypto.randomInt()`／
     `crypto.randomBytes()` 本身不可重新播放（沒有可以事後拿出來重算的「種子」，每次呼叫的內部
     熵無法保存與重現），若事後有人質疑某次開獎結果是否被竄改，你唯一能做的是「再抽一次全新的
     隨機序列」拿去跟舊結果比對——但新序列本身也是隨機的，兩者本來就該不一樣，這種比對毫無意義。
     因此開獎必須採用「先產生一個 CSPRNG 種子並存起來，再用種子推導出決定性（deterministic）排列」
     的做法，讓「重演」這件事有意義：只要重新輸入同一組 `(seed, entry_snapshot)`，任何人都能
     獨立算出一模一樣的最終排名，藉此驗證平台當初真的沒有動手腳。
   - **名單快照**：開獎當下（`lotteries.status` 從 `open` 轉 `drawing` 的同一個 transaction 裡），
     把該抽籤所有 `status='entered'` 的報名，依 `(entered_at asc, id asc)` 排序後取出 entry id
     陣列，寫入 `lotteries.entry_snapshot`；這個陣列就是餵給 shuffle 演算法的「洗牌前」順序。
   - **決定性洗牌演算法**（`algo_version = "hmac-sha256-fisher-yates-v1"`）：用 seed 當 HMAC 金鑰、
     一個遞增計數器當訊息，對 Fisher-Yates 洗牌演算法裡每一步需要的隨機索引，改用
     `HMAC-SHA256(seed, counter)` 的輸出（讀前 32 bits 當無號整數）取代 `Math.random()`：
     ```
     function deterministicShuffle(entryIds: string[], seedHex: string): string[] {
       const arr = [...entryIds]; // = entry_snapshot，洗牌前的 canonical 順序
       const key = Buffer.from(seedHex, "hex");
       let counter = 0;
       for (let i = arr.length - 1; i > 0; i--) {
         const digest = crypto.createHmac("sha256", key)
           .update(Buffer.from(String(counter++)))
           .digest();
         const j = digest.readUInt32BE(0) % (i + 1);
         [arr[i], arr[j]] = [arr[j], arr[i]];
       }
       return arr; // arr[0] = rank 1（首獎），arr[1] = rank 2（第一順位遞補）……
     }
     ```
     備註：`% (i + 1)` 存在極輕微的 modulo bias，但在正常報名規模（遠低於 10 萬人）下可忽略不計；
     若未來單一抽籤報名數可能上看數十萬人以上，才需要改用 rejection sampling 版本，M5 v1 不需要。
   - **重演驗證**：任何人（審計、申訴處理）只要拿到 `(lotteries.seed, lotteries.entry_snapshot,
     lotteries.algo_version)`，重新執行同一個 `deterministicShuffle`，結果應該與 `lottery_results`
     裡按 `rank` 升冪排列的 `entry_id` 序列**逐筆相同**；不同即代表資料被竄改，應視為資安事件。

5. **開獎與遞補排程 job（沿用 M3 的 `system_jobs`／`system_job_runs` 機制，不重新發明）**：
   在 M3 建立的排程觸發＋idempotent 執行框架上新增一個 job kind（沿用同一套 `CRON_SECRET`
   保護的 route 觸發模式），建議執行頻率**每 15 分鐘一次**（比 M3 到期 job 的「每日」更頻繁，
   因為 48h 確認倒數需要相對即時的推進；48h 的容錯空間下，任何 ≤ 1 小時的執行間隔都可接受，
   實際頻率由屆時的 cron 基礎設施——Cronicle／Crontab UI／cron-job.org／GitHub Actions
   ——彈性決定，不強制一定要 15 分鐘）。每次執行做兩件事：
   - **(a) 開獎**：找出 `status='open' AND entry_deadline<=now()` 的抽籤。若報名數為 0，直接轉
     `failed_no_entries`（不需要洗牌）並寫 audit log；否則依交付內容 4 的演算法產生排名，
     寫入 `lottery_results`（每個 rank 一筆，rank 1 的 `status='offered'`、
     `offered_at=now()`、`confirm_deadline=now()+48h`，其餘 rank 為 `pending`），
     `lotteries.status` 轉 `awaiting_confirmation`、`current_rank=1`，通知 rank 1 候選人與物主。
   - **(b) 遞補推進**：找出 `lottery_results.status='offered' AND confirm_deadline<=now()`
     的列（代表逾時未確認），把該列轉 `expired`，往下找 `rank = current_rank+1` 的列：
     若存在，轉為 `offered`（`offered_at=now()`、`confirm_deadline=now()+48h`，**每個新候選人都
     是重新起算完整 48 小時，不是從原本的截止時間扣掉已過去的時間**），`lotteries.current_rank`
     前進一位，通知新候選人與物主；若不存在（`entry_snapshot` 已經遞補到底），
     `lotteries.status` 轉 `failed_no_entries`，通知物主「抽籤流標，已恢復開放留言/直贈」。
     **遞補終止條件**：遞補鏈的長度上限就是報名人數本身（`entry_snapshot.length`），每次遞補
     `current_rank` 只會嚴格遞增且不重複，rank 用盡即終止於 `failed_no_entries`，不會無限循環。
   - `PATCH /api/lotteries/[id]/decline`（交付內容 6）觸發的立即遞補走同一段「往下找
     `rank = current_rank+1`」邏輯，只是不必等 job tick，即時執行。
   - **關於「job lock」定案決策的技術選型澄清**：§11.3 定案「抽籤重複開獎＝job lock」，但沒有
     規定鎖的粒度是「整個 job 排他」還是「逐筆」。本規格採用**逐筆（per-lottery）樂觀鎖**——用
     `lotteries.status` 欄位的條件式 `UPDATE ... WHERE status='open'`（或 `WHERE status=
     'awaiting_confirmation' AND current_rank=$rank`）本身當鎖，多台 worker 或多次觸發同時
     處理同一筆抽籤時，只有一個能真正改到狀態、其餘拿到 0 rows affected 即視為 no-op；不同抽籤
     之間完全不互相阻塞。這是在「job lock」這個定案框架內做的技術選型（滿足「同一筆抽籤不會被
     處理兩次」的原意），不是要推翻這個決策；若之後發現逐筆鎖有未預期的競態，可以在不動
     `lottery_entries`/`items` 相關 schema 的前提下改成搭配 `system_job_runs` 的全域鎖，兩者
     可以並存。

6. **確認／婉拒 API（銜接既有 M1 貢獻值與交接，不新增計分邏輯）**：
   - `PATCH /api/lotteries/[id]/confirm`：僅限目前 `current_rank` 對應的 `lottery_results.
     status='offered'` 的那個使用者本人可呼叫；48h 內有效（過了 `confirm_deadline` 視同逾時，由
     job 遞補，這個 API 應該回 409）。同一個 transaction 內：該 `lottery_results` 列轉
     `confirmed`、`lotteries.status` 轉 `completed`、`completed_at=now()`、`items.status` 轉
     `reserved`，並寫 `lottery_audit_logs`（`item_reserved`）。之後接續既有 M1 交接流程
     （見交付內容 2），完全不修改 M1 既有 API。
   - `PATCH /api/lotteries/[id]/decline`：目前候選人主動婉拒，不必等 48h 逾時；該列轉
     `declined`，立即觸發交付內容 5 的遞補邏輯。
   - **貢獻值不變**：`contribution_events` 的記分邏輯（分享完成 +10、接手完成 +2、no_show -5）
     完全定義在 M1 既有的 `complete`/`no_show` 兩支 API 裡（見 `src/lib/contribution.ts`），一旦
     抽籤產生 `confirmed` 並把物品轉成 `reserved`，後續走的就是這兩支既有 API，**不需要為抽籤
     新增任何 contribution 邏輯**；抽籤本身（報名、未中選、婉拒、逾時）**不產生任何** contribution
     事件——沒中籤不扣分，只是沒加分。

7. **通知**（沿用 M1 既有 `notifications` 站內通知機制與鈴鐺 UI，不新增資料表；新增
   notification type 值即可）：
   - 開獎完成：通知 rank 1 候選人「你已中籤，請於 48 小時內確認」；通知物主「已完成開獎，
     正等待 OO 確認」。
   - 逾時或婉拒遞補：通知新候選人「遞補到你了，請於 48 小時內確認」；通知物主目前進度。
   - 流標（`failed_no_entries`）：通知物主「抽籤流標，無人確認，物品已恢復開放，可改用留言
     或直贈分享」。
   - 取消（物主主動 `cancel`）：通知所有目前 `entered` 狀態的報名者「這個抽籤已被物主取消」。
   - 最終確認完成：沿用 M1 既有交接通知（被接受、交接訊息等），不重複發送抽籤專屬通知。
   - **不做站外通知**（Telegram/Web Push）：全部走站內通知，站外通知是 M4/M6 的範圍，屆時如需要
     可另外串接，M5 不處理。

8. **稽核（`lottery_audit_logs`）**：以下每個事件各寫一筆，`actor_id` 為系統排程觸發時填 `null`：
   `entry_created`、`entry_cancelled`、`draw_started`、`draw_completed`、
   `draw_failed_no_entries`、`rank_offered`、`rank_confirmed`、`rank_expired`、`rank_declined`、
   `lottery_cancelled`、`item_reserved`。要求：對任一抽籤，把 `lottery_audit_logs` 依
   `created_at` 排序讀出來，應該能還原出完整時間序（誰在何時報名／取消、何時開獎、每次遞補的
   前因後果、最終誰確認），不需要額外查詢其他表輔助理解。

9. **頁面**：
   - 物品詳情頁 `/items/[id]` 新增抽籤區塊（比照 `thanks-section.tsx`／`handover-section.tsx`
     的既有拆分慣例，新增 `lottery-section.tsx`）：報名中顯示目前總人數與倒數、我是否已報名／
     可否取消；確認期顯示「你中籤了，請確認」或「等待中選人確認中」（依當前使用者是否為
     `current_rank` 本人而不同）；流標/取消/完成後顯示對應結果文字。
   - 不新增獨立頁面路由；抽籤狀態完全嵌在既有物品詳情頁裡，符合 §11.6 頁面地圖精神
     （M5 不擴充頁面地圖）。

10. **索引**（附加於 §11.2 既有定案索引之外，不與其衝突）：
    ```
    lotteries(status, entry_deadline)        -- job 用來撈到期未開獎的抽籤
    lottery_results(status, confirm_deadline) -- job 用來撈到期未確認的候選人
    lottery_entries(lottery_id, status)       -- 開獎時撈 status='entered' 名單
    ```
    （`lottery_entries(lottery_id, user_id)` 的 unique 索引本身依 §11.2 定案，此處不重複列出。）

### 不做（scope guard）

- **不做多輪抽籤**：`lotteries.item_id` 是 `@unique`，一物品終身最多一次抽籤；一旦
  `cancelled` 或 `failed_no_entries` 便永久定案，物主只能改用留言先到先得或直贈分享同一物品，
  不能重新開一次抽籤。
- **不做多名額／多階段抽籤**：一次抽籤只解出 1 位最終得獎人（其餘只是遞補順位，不是「同時中籤」），
  不支援「一次抽出前 3 名各自帶走一份」這種玩法——本平台每個物品本來就是單一件，不做多數量物品。
- **不做任何付費加碼中籤率、購買額外抽籤機會、或贊助曝光**：本平台完全不做金流（§1 non-goals），
  這條不只是「M5 不做」，是永久禁止，任何 session 都不得以任何名義加回。
- **不做即時（realtime）開獎體感**：開獎與遞補都由排程 job（建議每 15 分鐘一次）處理，不做
  「倒數到 0 秒立刻跳出結果」的前端即時效果；使用者需要重新整理頁面或等下一輪站內通知/列表
  polling 才會看到最新狀態，與 M1 私訊 polling 的精神一致。
- **不做站外通知**：中選/遞補/流標事件只發站內通知，Telegram/Web Push 留給 M4/M6。
- **不做 admin 抽籤管理後台**（監控、手動重抽、手動遞補等）：M2 治理後台與 M8 營運強化的基礎
  設施都還沒做，M5 只做前台 API 與使用者可見流程；出問題時工程師需直接查 DB／
  `lottery_audit_logs` 手動處理，待 M2/M8 之後再補 `/admin/lotteries`。
- **不做抽籤截止時間事後編輯**：`entry_deadline` 建立後不可修改，設錯只能整個取消（且會受
  「不做多輪抽籤」影響，永久失去該物品的抽籤資格）——這是刻意的簡化取捨，細節見下方
  「已知取捨」。
- **不做跨物品抽籤**：一個 `lotteries` 列永遠對應恰好一個 `items` 列，不支援「一次抽籤綁定
  多個物品」或「抽籤包」。
- **不做報名資格限制**：任何登入使用者皆可報名任何抽籤物品，不依貢獻值、縣市等做資格篩選；
  若未來要做（例如防止外縣市搶熱門物品），屬於未來版本的獨立提案，不在 M5 範圍。

**已知取捨（設計者自己判斷、非定案決策，供後續使用者/工程師參考）**：
`entry_deadline` 不可修改 + `item_id` unique 的組合，代表物主一旦把截止時間設錯，唯一的
修正方式是整個取消抽籤——但取消之後這個物品就永久不能再抽籤了，只能靠留言或直贈分享。這是為了
配合「不做多輪抽籤」這個刻意的簡化決策所產生的副作用，不是理想的使用者體驗。緩解方式：
上架建立抽籤前的表單可以在前端加強確認流程（例如二次確認截止時間），但這不需要動 schema，
留給實作時的表單設計判斷；如果之後使用者回報這個限制造成真實困擾，可以考慮把
「取消後可重建」的規則放寬（例如「零報名時取消可重建，已有報名後取消才永久鎖死」），但那會
是一個需要使用者同意的規則變更，M5 v1 先用最簡單版本。

### 驗收清單

- [ ] 乾淨 DB `prisma migrate deploy` 後 `lotteries`／`lottery_entries`／`lottery_results`／
      `lottery_audit_logs` 四張表皆存在；直接查 DB schema 確認 `lottery_entries` 有
      `unique(lottery_id, user_id)` 索引、`lotteries.item_id` 有 unique 索引。
- [ ] 物主為一個 `published` 物品建立抽籤（設定 `entryDeadline`）：`items.status` 仍是
      `published`；`GET /api/items/[id]` 或抽籤子路由可看到抽籤區塊與倒數。
- [ ] 該物品存在非終態抽籤時，打 `POST /api/items/[id]/claims`（留言）與
      `POST /api/items/[id]/direct-shares`（直贈）均回 409；抽籤 `failed_no_entries` 之後，
      同樣兩個請求恢復成功（回 201）。
- [ ] 併發測試：同一使用者兩個請求同時打 `POST /api/items/[id]/lottery/entries`
      （`Promise.all` 打同一端點）→ 恰好一筆 entry 成功，另一筆回 409（unique constraint 擋下）。
- [ ] 併發測試：兩個請求同時觸發開獎 job route（模擬多台 worker 或重複觸發）→ 用
      `lotteries.status` 的條件式 UPDATE 驗證只有一次真正執行開獎、另一次是 no-op
      （寫成整合測試，斷言 `lottery_results` 只被寫入一次）。
- [ ] 開獎後 `lotteries.seed`／`entry_snapshot`／`algo_version` 皆正確寫入；`lottery_results`
      依 `rank` 升冪排列的 `entry_id` 序列，與拿同一組 `(seed, entry_snapshot)` 重新執行
      `deterministicShuffle` 得到的結果**逐筆相同**（寫成單元測試，驗證「重演驗證」成立）。
- [ ] rank 1 候選人在 48h 內未確認也未婉拒 → job 執行後該列轉 `expired`、自動遞補到 rank 2、
      rank 2 收到通知、`confirm_deadline` 是從遞補當下重新起算的 48 小時（不是延續原本的
      截止時間）。
- [ ] rank 1 候選人主動打 `PATCH /api/lotteries/[id]/decline` → 立即（不必等 job tick）遞補到
      rank 2，`lottery_audit_logs` 有對應 `rank_declined` 與 `rank_offered` 兩筆紀錄。
- [ ] 所有候補都逾時或婉拒用盡（`entry_snapshot` 遞補到底）→ `lotteries.status` 轉
      `failed_no_entries`；`items.status` 維持 `published`；物主收到流標通知。
- [ ] 有候選人成功 `PATCH /api/lotteries/[id]/confirm` → `lotteries.status` 轉 `completed`、
      `items.status` 轉 `reserved`；不修改任何既有程式碼的前提下，能無痛接續
      `POST /api/items/[id]/handover/ensure` 既有交接流程直到雙方確認完成。
- [ ] 完成交接後，`contribution_events` 依 M1 既有規則記分（分享者 +10、中選者 +2）；同一抽籤裡
      未中籤／婉拒／逾時的其他報名者**不產生任何** `contribution_events` 紀錄。
- [ ] 非物主打 `PATCH /api/lotteries/[id]/cancel` → 403；物主在 `status≠open` 時打同一端點 →
      409；`status=open` 時物主成功取消 → 所有 `entered` 報名者收到取消通知。
- [ ] 對一個跑完「報名→開獎→逾時→遞補→確認」全流程的抽籤，把 `lottery_audit_logs` 依
      `created_at` 讀出，人工檢查能還原出完整、無缺漏的時間序。
- [ ] Playwright E2E：一次跑完「物主開抽籤 → 3 個帳號報名 → 觸發開獎 → 手動把 rank 1 的
      `confirm_deadline` 撥到過去並觸發 job 模擬逾時 → rank 2 收到遞補通知並確認 → 交接
      → 雙方完成」全流程綠燈。
- [ ] `docs/governance/judgment-rubrics.md` §5 三組底線逐條過（比照 M1 驗收慣例）。

---

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
- [ ] Google OAuth 品牌驗證（2026-07 查證：未驗證品牌的同意畫面只顯示網域不顯示 app 名稱）：
      Search Console 驗證網域 → Branding 頁填齊（含 /privacy 網址，依賴上一項的隱私頁）→
      Verify Branding → Publish branding。
- [ ] SEO/AEO gate（§3.7）：Lighthouse SEO ≥ 90；物品頁通過 Google Rich Results Test；
      robots.txt/sitemap.xml/llms.txt 在正式網域可存取。

## 13. 本檔維護

- 勾選進度、為 M5–M8 補細部規格：任何 session 可做（照 maintenance-protocol.md）。
- 改動已定案決策（§1 non-goals、§2 技術棧、§4 砍線、§12 gate）：**必須先問使用者**。
