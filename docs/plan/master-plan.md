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
TELEGRAM_BOT_USERNAME   # M4 起：bot 的 @username（不含 @），組深連結
                        # https://t.me/<username>?start=<token> 用
WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY    # M6 起：Web Push VAPID 金鑰對，用
                        # `npx web-push generate-vapid-keys` 產生；public key 前端可見，
                        # private key 僅伺服器持有
WEB_PUSH_VAPID_SUBJECT  # M6 起：VAPID subject，格式 mailto:<站方聯絡信箱>，Web Push 規範要求
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

M5、M6、M7、M8 皆已依照上面的要求產出細部規格，依序見緊接在下面的 §5a／§6a／§7a／§8a
（格式比照 M0–M4）；**這四份細部規格都需經使用者確認後才能進入實作，M7 額外要求法務相關
段落需經台灣律師審閱**。

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

M6 已依照上面的要求產出細部規格，見緊接在下面的 §6a（格式比照 M0–M5）；**這份細部規格需經使用者
確認後才能進入實作**。其餘尚未細化的 milestone 比照本節開工前的原則，各自開工前再產出。

## 6a. M6 — 訂閱通知＋Web Push（v1.2，細部規格）

**目標**：使用者不必每天回站上滑列表，也能在符合自己興趣（關鍵字／分類／縣市）的新物品上架時被
通知到——先天天收一封摘要（預設），想要更即時的人可自己打開即時通知；即時推播額外支援 Web Push，
不必依賴 Telegram 或開著分頁。
**依賴**：M1（`items` 的 `status`／`publishedAt`／`categoryId`／`cityId`，本規格只讀取，不新增
欄位、不修改既有上架/列表 API）、M3（`system_jobs`／`system_job_runs` 排程觸發＋idempotent
執行機制，本規格新增兩個 job kind 掛在同一套機制上）、M4（`notifications`／
`notification_preferences`／`notification_deliveries`／`NotificationChannel` enum，本規格
新增通知內容與一個新的 channel 值，沿用既有的建立通知、偏好檢查、派送重試機制，不重新發明）。

### 交付內容

1. **資料表與欄位**（表名依 §11.1 定案：`user_subscriptions`、`subscription_keywords`、
   `subscription_categories`、`subscription_cities`、`subscription_matches`、
   `subscription_digest_jobs`、`web_push_subscriptions`，不可更改；以下欄位為本規格新增設計，
   命名依 §3.1 慣例）。

   `user_subscriptions`（一個使用者最多 20 筆，見交付內容 3 的上限驗證）：
   ```
   id
   userId              FK → users.id
   label               text, nullable   -- 使用者自訂名稱（例：「台北的腳踏車」），純顯示用，不參
                                         -- 與比對邏輯
   immediateEnabled    boolean, default false  -- 即時通知（預設關）
   dailyDigestEnabled  boolean, default true   -- 每日摘要（預設開）
   createdAt / updatedAt
   ```
   **即時／每日摘要開關設計在「每一筆訂閱」上，不是使用者帳號層級的全域開關**：使用者可能對某個
   稀有物品的訂閱想要即時通知，但對「所有居家生活類物品」這種寬鬆訂閱只想每天看一次摘要，兩者
   顆粒度不同，故做成每筆訂閱各自的欄位。兩個開關互不排斥，可同時開（見交付內容 6 的通知去重
   規則說明兩者如何互動）。

   `subscription_keywords`（每筆訂閱最多 5 個，見交付內容 3 的上限驗證；`normalized_keyword` 索引
   依 §11.2 定案）：
   ```
   id
   subscriptionId     FK
   keyword            text   -- 使用者原始輸入，保留給 UI 顯示（可能是全形/大寫）
   normalizedKeyword  text   -- 正規化後的比對用字串，規則見交付內容 5
   createdAt
   @@unique([subscriptionId, normalizedKeyword])  -- 同一訂閱內防止「iPhone」「iphone」這種正規化
                                                    -- 後其實同義的重複關鍵字
   ```

   `subscription_categories` / `subscription_cities`（多對多join表，皆無額外人為上限——見下方
   「不設分類/縣市上限」的理由）：
   ```
   subscription_categories: id / subscriptionId FK / categoryId FK / createdAt
     @@unique([subscriptionId, categoryId])
   subscription_cities:     id / subscriptionId FK / cityId FK / createdAt
     @@unique([subscriptionId, cityId])
   ```
   **不設分類/縣市上限**：關鍵字是自由文字，不設上限會被濫用塞成千上萬個關鍵字，因此設 5 個硬
   上限；分類（9 種）與縣市（22 縣市）本身選項有限，全選等同「這個維度不篩選」，不會造成關鍵字
   那種輸入濫用風險，`@@unique` 已經防止重複勾選同一項，故不需要額外的數量上限。

   `subscription_matches`（本規格「同物品同訂閱只通知一次」的 idempotency 核心，見交付內容 7）：
   ```
   id
   subscriptionId  FK
   itemId          FK
   matchedAt       timestamptz (= createdAt)  -- 比對 job 判定符合條件的當下
   notifiedAt      timestamptz, nullable      -- 實際通知出去（不論走哪個管道）的時間；NULL 代表
                                               -- 已比對成功但尚未通知（等每日摘要 job 撿走）
   notifiedVia     text, nullable             -- 'immediate' | 'digest'
   digestJobId     FK → subscription_digest_jobs.id, nullable  -- notifiedVia='digest' 時填
   @@unique([subscriptionId, itemId])
   ```

   `subscription_digest_jobs`（每人每個台北曆日最多一筆，是每日摘要的「派送紀錄」而非排程本身
   ——排程觸發沿用 M3 的 `system_jobs`／`system_job_runs`，這張表記錄的是「對某個使用者這一天
   的摘要處理到哪」）：
   ```
   id
   userId      FK
   digestDate  date   -- Asia/Taipei 曆日（不是 UTC 日期，比照 §3.4 全站時區慣例）
   status      text   -- 'pending' | 'sent' | 'skipped_empty' | 'failed'
   itemCount   int, default 0
   sentAt      timestamptz, nullable
   createdAt
   @@unique([userId, digestDate])
   ```

   `web_push_subscriptions`（同一使用者可有多筆——多裝置/多瀏覽器；欄位對應瀏覽器 Push API
   標準的 `PushSubscription` 物件）：
   ```
   id
   userId         FK
   endpoint       text  @unique   -- push service 的推播端點 URL，瀏覽器端唯一
   p256dhKey      text            -- PushSubscription.keys.p256dh
   authKey        text            -- PushSubscription.keys.auth
   userAgent      text, nullable  -- 除錯與清理用，非必要
   isActive       boolean, default true
   failureCount   int, default 0
   lastSuccessAt  timestamptz, nullable
   lastFailureAt  timestamptz, nullable
   createdAt
   deactivatedAt  timestamptz, nullable
   ```

2. **與 M4 通知偏好頁的分工（正交設計，不可混在同一套 UI/資料表裡）**：
   - **訂閱**（`user_subscriptions` 及其 keywords/categories/cities）回答的問題是「我對什麼樣的
     新物品感興趣」——這是內容篩選條件，使用者在 `/me/subscriptions`（見交付內容 9）管理。
   - **通知偏好**（M4 既有 `notification_preferences`，`eventType` 為字串 key）回答的問題是
     「我要不要收到某一類事件的通知、要不要外送到站外管道」——這是管道與開關，使用者在 M4
     既有的通知偏好頁管理（確切路由由 M4 實作時定案，本規格不重新指定）。
   - 兩者是**兩層獨立的閘門**，缺一都不會發送：訂閱的 `immediateEnabled` 只決定「符合條件時，是
     要立刻通知還是併入明天的每日摘要」這個**時機**問題；不論選哪個時機，實際「站內通知要不要建立、
     要不要外送到 Telegram／Web Push」仍然要另外查 M4 的 `notification_preferences`（本規格新增
     兩個 `eventType` 值：`subscription_match`（即時比對命中）與 `subscription_digest`（每日摘要）
     ——即使使用者把某訂閱設成 `immediateEnabled=true`，只要他在 M4 偏好頁把 `subscription_match`
     這個事件類型的外部通知關掉，該訂閱仍然只會產生站內通知、不會發 Telegram/Web Push；這正是
     「訂閱決定內容與時機、偏好頁決定管道」分工的具體體現。
   - M4 通知偏好頁需要新增可勾選的兩列（`subscription_match`／`subscription_digest`），這是對 M4
     既有 UI 的擴充項目，不修改 M4 既有 API 契約（`notification_preferences` 的 `eventType` 本來
     就是自由字串，不是 enum，新增事件類型不需要 migration）。
   - Web Push 的「啟用/停用瀏覽器推播」這個裝置層級開關，放在 `/me/subscriptions` 頁面頂端（見
     交付內容 9），而不是放進 M4 通知偏好頁：因為 M6 v1 階段 Web Push 唯一的用途就是通知訂閱
     比對結果，放在同一個頁面體驗上比較直覺；若之後有其他事件類型也想用 Web Push 管道，那會是
     未來版本要把它搬到通用管道管理頁的決定，不在 M6 範圍內。

3. **訂閱建立/編輯/刪除 API（上限一律 server-side 驗證，不能只靠前端）**：
   - `POST /api/subscriptions`：建立一筆訂閱（`label`、`immediateEnabled`、`dailyDigestEnabled`、
     `keywords[]`（≤5，每個做交付內容 5 的正規化）、`categoryIds[]`、`cityIds[]`）。寫入前對
     `keywords`（正規化後）、`categoryIds`、`cityIds` 各自去重（例如 `Array.from(new Set(...))`），
     避免輸入重複值觸發 `@@unique([subscriptionId, categoryId])`/`@@unique([subscriptionId,
     cityId])` 拋出 500。三個篩選維度（關鍵字/分類/縣市）**至少要有一個非空**，否則回 422
     （避免建立「什麼都比對」的訂閱，對比對 job 與使用者自己都是雜訊）。同一 transaction 內先數
     使用者目前訂閱數，`>= 20` 回 422（`{"error":{"code":"VALIDATION_ERROR","message":"訂閱已達
     上限（20 筆）"}}`）；
     `keywords.length > 5` 回 422。
     **已知取捨**：這個計數檢查與寫入不是同一個原子操作（Postgres 預設 READ COMMITTED 下，同一
     使用者從兩個分頁同時快速連點「新增訂閱」有極小機率讓計數短暫超過 20），影響範圍僅止於這個
     使用者自己多出 1 筆訂閱，不影響其他使用者也不是安全問題，MVP 先接受這個機率極低的邊界情況；
     若要完全杜絕，可在 `users` 列上加 `SELECT ... FOR UPDATE` 或改用 serializable transaction，
     留給之後如果真的觀察到濫用再加。
   - `GET /api/subscriptions`：列出自己的訂閱（cursor 分頁，依 §3.2 慣例），每筆帶目前累積的
     `subscription_matches` 總數與未通知數，方便使用者知道這個訂閱「有沒有在動」。
   - `GET /api/subscriptions/[id]`：單筆詳情（含 keywords/categories/cities）；非本人 403。
   - `PATCH /api/subscriptions/[id]`：整包替換語意——同一 transaction 內刪除舊的
     `subscription_keywords`/`subscription_categories`/`subscription_cities`，依 request body
     重新寫入，上限驗證同建立；非本人 403。
   - `DELETE /api/subscriptions/[id]`：刪除訂閱；FK cascade 一併刪掉關聯的 keywords/categories/
     cities/matches（`subscription_matches` 只是比對進度用的輔助表，不是稽核 log，刪除訂閱時
     一併清掉沒有保留價值）；非本人 403。
   - `POST /api/web-push/subscriptions`：前端把瀏覽器 `PushSubscription.toJSON()` 的
     `endpoint`/`keys.p256dh`/`keys.auth` 傳進來，upsert（依 `endpoint` unique）一筆
     `web_push_subscriptions`，`isActive` 重設為 true（同一裝置重新訂閱時復活舊紀錄而非產生
     重複列）。
   - `DELETE /api/web-push/subscriptions`：body 帶 `endpoint`，刪除/停用呼叫者名下對應那一筆
     （多裝置時只解除當下這一支裝置，不影響其他裝置）；`endpoint` 不屬於呼叫者本人 → 404。

4. **item 上架後怎麼觸發比對：排程掃描，不做上架當下同步比對**（沿用 M3 `system_jobs`／
   `system_job_runs` 機制，新增 job kind `subscription_match_scan`，建議每 5 分鐘觸發一次）：
   上架當下同步比對對高流量不友善（每次上架都要即時掃過所有使用者的所有訂閱，拖慢上架 API 的
   回應時間，且上架 API 目前完全不知道訂閱系統存在，M6 不應該讓它多一個外部相依）；改採「新
   `system_jobs` job kind + 週期性掃描」：
   - **cursor 設計**：不新增額外的 cursor 表，直接沿用 `SystemJobRun.detail`（既有 `Json?` 欄位）
     存 `{"cursor": {"publishedAt": "...", "id": "..."}}`；每次執行先讀該 job 最近一筆
     `status='success'` 的 `SystemJobRun.detail.cursor`，撈
     `items.status='published' AND (published_at, id) > cursor`（依 `published_at asc, id asc`
     排序，一批最多 500 筆，避免單次執行時間過長，剩下的下次 tick 繼續處理），執行完把本次掃到
     的最後一筆 `(publishedAt, id)` 寫進這次 run 的 `detail.cursor`。**關鍵前提**：物品從
     `reserved`／`handover_pending` 等狀態退回 `published`（例如認領被取消、no-show 退回）時，
     既有的狀態轉移邏輯必須把 `publishedAt` 更新為 `now()`，否則舊的 `publishedAt` 會小於 cursor
     已經前進到的位置，導致這次「重新上架」永遠不會被掃描 job 撈到、訂閱者收不到通知——這點
     順便也讓物品在前台列表重新置頂，符合使用者對「重新開放」的直覺預期。
   - **這個 job 首次上線時，cursor 起點 = 上線當下的時間**，不回溯掃描既有已上架的物品（見「不做」
     的「不做建立訂閱時回填比對存量物品」，理由相同：避免第一次跑就要處理全庫存量造成長時間
     阻塞）。
   - 每次執行同時把所有 `user_subscriptions`（含關聯 keywords/categories/cities）讀進記憶體，
     對這批新物品逐一跑交付內容 5 的比對邏輯；命中就用 `ON CONFLICT (subscription_id, item_id)
     DO NOTHING` 寫入一筆 `subscription_matches`（因為同一批掃描不會重複處理同一個物品，這裡的
     `ON CONFLICT DO NOTHING` 主要防的是「job 因故被觸發兩次、cursor 還沒推進導致同一批物品被
     掃兩次」這種情況，而不是防同一物品被兩個不同比對維度各命中一次——同一個 `(subscriptionId,
     itemId)` 不管命中幾個維度都只會是一筆，因為比對函式對每個 `(subscription, item)` pair 只
     判斷一次 true/false）。
   - 對每筆**新插入成功**（代表這是這次 tick 才第一次命中，不是重複）且該訂閱
     `immediateEnabled=true` 的 match，在同一個 transaction 裡立刻依交付內容 6 建立通知並把
     `notifiedAt`/`notifiedVia='immediate'` 寫回同一列；`immediateEnabled=false` 的訂閱，這筆
     match 先留著 `notifiedAt=NULL`，等交付內容 8 的每日摘要 job 撿走。

5. **關鍵字/分類/縣市比對邏輯**：
   - **正規化規則**（`normalizeKeyword`，建立/編輯訂閱時對每個關鍵字套用一次存進
     `normalized_keyword`，比對 job 對每個物品的 title+description 也套用同一函式）：
     ```
     function normalizeKeyword(raw: string): string {
       return raw
         .normalize("NFKC")   // 全形→半形、相容字元正規化（含全形英數字/全形符號），
                               // 「Ｉphone」「iPhone」正規化後一致
         .trim()
         .toLowerCase();       // 大小寫不敏感
     }
     ```
     **建立/編輯訂閱的 API 必須拒絕正規化後長度為 0 的關鍵字**（例如只輸入空白字元）：若不擋，
     `normalizedItemText.includes("")` 恆為 `true`，會讓該訂閱無條件命中所有新上架物品，形同
     關鍵字篩選完全失效。驗證順序是先正規化、再檢查長度 > 0，不合格的關鍵字整批回 422。
   - **比對規則**：三個維度內部用 OR，跨維度用 AND；某維度沒設定就視為該維度不篩選（永遠 true）：
     ```
     function isMatch(subscription, item, normalizedItemText): boolean {
       const keywordOk = subscription.keywords.length === 0
         || subscription.keywords.some(k => normalizedItemText.includes(k.normalizedKeyword));
       const categoryOk = subscription.categories.length === 0
         || subscription.categories.some(c => c.categoryId === item.categoryId);
       const cityOk = subscription.cities.length === 0
         || subscription.cities.some(c => c.cityId === item.cityId);
       return keywordOk && categoryOk && cityOk;
     }
     // normalizedItemText = normalizeKeyword(item.title + " " + item.description)
     ```
     關鍵字採**子字串**比對（`includes`），不是整詞比對：中文沒有空白分詞，若採「整詞相等」會讓
     「腳踏車」這種關鍵字幾乎比對不到任何自然語句，子字串比對雖然會有少量誤判（例如關鍵字「腳踏」
     命中「腳踏車」也會命中「腳踏實地」這種罕見情境），但符合中文使用者對「關鍵字通知」的直覺
     期待，且誤判成本低（頂多多收一則不相關通知，不是安全問題）。
   - **效能已知限制（MVP 階段接受，非本規格要解決）**：目前設計是「每次 tick 把全部訂閱讀進
     記憶體，對每個新物品逐一跑比對」，複雜度是 O(新物品數 × 總訂閱數)。§11.2 定案的
     `subscription_keywords(normalized_keyword)` 索引在這個設計下主要用於「依關鍵字反查有哪些
     訂閱／除錯／未來的濫用調查」，不是熱路徑比對本身在用；當活躍訂閱數成長到數千筆以上、
     每次 tick 都要重新載入全部訂閱開始有感時，可以考慮改用 Postgres `pg_trgm` 或專用全文檢索
     服務做關鍵字反查以降低複雜度，但這是超出 M6 範圍的未來優化，先用最簡單版本上線。

6. **通知內容與 M4 整合**（沿用既有 `notifications` 站內通知機制與鈴鐺 UI，不新增資料表；新增
   兩個 `NotificationType`／`eventType` 值 `subscription_match`、`subscription_digest`）：
   - `subscription_match`：payload 帶 `subscriptionId`、`subscriptionLabel`、`itemId`、
     `itemTitle`、`itemCityName` 等足夠 UI 顯示一則「你訂閱的『OO』有新物品：《XX》」的資訊。
   - `subscription_digest`：payload 帶當天符合條件的物品清單（見交付內容 8），上限顯示前 10 筆
     ＋「還有 N 筆，請至 `/me/subscriptions` 查看」。
   - 依 M4 既有機制查詢 `notification_preferences`（`eventType='subscription_match'` 或
     `'subscription_digest'`）決定是否建立站內通知、是否嘗試外部管道派送，沿用 M4 既有邏輯與
     `notification_deliveries` 的 idempotency／重試機制，本規格不重新定義這兩個欄位的語意。
   - 需要在 M4 的 `NotificationChannel` enum 新增 `web_push` 值（目前只有 `telegram`），
     `notification_deliveries` 既有的 `@@unique([notificationId, channel])` 天然適用於
     `web_push` channel，不需要新增欄位。

7. **「同物品同訂閱只通知一次」的 idempotency 設計**：核心就是 `subscription_matches` 的
   `@@unique([subscriptionId, itemId])`——**「比對命中」這個事實本身只會被記錄一次**，不管是
   即時比對 job 還是每日摘要 job 先發現的都一樣，因為兩者都走同一張表、同一個 unique constraint、
   同一個 `ON CONFLICT DO NOTHING` 語意。「要不要通知、通過哪個管道」是這筆已經去重過的 match
   列的**後續狀態**（`notifiedAt`/`notifiedVia`），不是另一層去重機制：
   - 若訂閱 `immediateEnabled=true`：比對 job 一發現新 match 就立刻通知並蓋章
     `notifiedAt`/`notifiedVia='immediate'`——之後不管每日摘要 job 怎麼跑，都只會撈
     `notifiedAt IS NULL` 的列，這筆已經蓋章的列永遠不會被摘要 job 撿到，達成「不會又發一次」。
   - 若訂閱只開 `dailyDigestEnabled=true`（`immediateEnabled=false`）：比對 job 一樣會插入
     match 列，但**不**在當下通知，`notifiedAt` 留 `NULL`，等每日摘要 job 撿走並蓋章
     `notifiedVia='digest'`。
   - 這與 M1 handover 用 `updateMany` + 影響列數判斷完成狀態的精神一致：都是「用一個資料庫層級
     的唯一性/條件式寫入來保證同一件事只會發生一次」，差別只在於這裡去重的是「比對命中」這個
     事件，不是「使用者的一個動作」。

8. **每日摘要 job（沿用 M3 `system_jobs`／`system_job_runs`，新增 job kind
   `subscription_daily_digest`，建議每天 08:00 Asia/Taipei 觸發一次，避免半夜打擾使用者）**：
   - 找出所有 `subscription_matches.notifiedAt IS NULL` 且其所屬 `subscription.
     dailyDigestEnabled=true` 的列，依 `subscription.userId` 分組。
   - 對每個 `userId`：先用 `INSERT ... ON CONFLICT (user_id, digest_date) DO NOTHING` 嘗試建立
     今天（Asia/Taipei 曆日）的 `subscription_digest_jobs` 列（`status='pending'`）；若撞到
     unique，要看既有那筆的狀態：`status IN ('sent', 'skipped_empty')` 代表今天已經成功處理過
     這個使用者，直接跳過；`status IN ('failed', 'pending')`（暫時性錯誤失敗、或前一次執行中途
     崩潰留下的半成品）則**允許重新處理**，沿用同一列繼續走完流程——否則使用者會因為一次偶發的
     網路錯誤或 Web Push 服務暫時不通，當天永遠收不到摘要通知。這是「同一天不重複\*成功\*發送
     摘要」的 idempotency 機制，即使 job 因故被重複觸發，也不會對已成功處理的使用者重發。
   - 過濾掉物品目前狀態已經不是 `published` 的 match（例如被搶先接手、下架、過期——避免摘要裡
     出現點進去是死連結的物品）；這些被過濾掉的列仍然蓋章 `notifiedAt=now()`／
     `notifiedVia='digest'`／`digestJobId`（代表「已處理，不會再被下次摘要 job 重複檢視」），
     只是不放進通知內容裡顯示。
   - 過濾後若剩餘 0 筆，`subscription_digest_jobs.status='skipped_empty'`，不建立通知（避免
     每天發一封「今天沒有符合條件的新物品」這種空摘要打擾使用者）。
   - 否則依交付內容 6 建立一則 `subscription_digest` 通知，把本次涉及的所有 match 列蓋章
     `notifiedAt=now()`／`notifiedVia='digest'`／`digestJobId=`本次 `subscription_digest_jobs.id`，
     `subscription_digest_jobs.status='sent'`／`itemCount`／`sentAt` 一併寫入，全部包在同一個
     transaction 裡。

9. **Web Push 技術細節**：
   - **VAPID**：用 `web-push` npm 套件的 `webpush.generateVAPIDKeys()`（或 CLI
     `npx web-push generate-vapid-keys`）產生一組金鑰對，寫入 §3.4 新增的
     `WEB_PUSH_VAPID_PUBLIC_KEY`/`WEB_PUSH_VAPID_PRIVATE_KEY`/`WEB_PUSH_VAPID_SUBJECT`
     三個環境變數（subject 是 Web Push 規範要求的聯絡方式，格式 `mailto:<站方聯絡信箱>`）。
   - **Service Worker**：新增 `public/sw.js`，監聽 `push` 事件呼叫
     `self.registration.showNotification(title, {body, icon, data:{itemUrl}})`；監聽
     `notificationclick` 事件時，**`clients.openWindow()` 本身沒有「找既有分頁」的語意，一定是
     開新分頁**——要做到「優先 focus 既有分頁」必須自己用 `clients.matchAll({type:'window'})`
     取得所有已開啟的視窗、比對 URL 是否吻合，找到就呼叫該 `client.focus()`，都沒找到才呼叫
     `clients.openWindow(event.notification.data.itemUrl)`。
   - **前端註冊流程**：`/me/subscriptions` 頁頂端提供「啟用瀏覽器推播通知」開關 →
     `navigator.serviceWorker.register('/sw.js')` → 使用者同意瀏覽器通知權限提示 →
     `registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:
     <WEB_PUSH_VAPID_PUBLIC_KEY 轉成的 Uint8Array>})` → 拿到的 `PushSubscription` 呼叫
     `POST /api/web-push/subscriptions` 存進 `web_push_subscriptions`。
   - **失效偵測與自動清理**（比照 M4 Telegram「發送失敗重試＋失效自動解綁」的精神，Web Push 的
     失效訊號比 Telegram 更明確——是標準化的 HTTP 狀態碼，不需要額外偵測邏輯）：`web-push` 套件的
     `sendNotification` 在推播服務回應非 2xx 時是**用 throw 一個帶 `statusCode` 的 Error 表達失敗**，
     不是回傳值，所以呼叫時必須包 `try/catch`：`try { await webpush.sendNotification(subscription,
     payload, {vapidDetails}) } catch (err) { ...依 err.statusCode 判斷... }`，沒有這層
     try/catch，失敗會直接讓派送 job 整個中斷。**`err.statusCode` 為 404/410（Gone）代表該裝置的
     推播訂閱已在瀏覽器端失效**（使用者關閉了通知權限、清除瀏覽器
     資料、或解除安裝），立刻把該筆 `web_push_subscriptions.isActive=false`／
     `deactivatedAt=now()`，之後派送直接跳過這筆；其他錯誤（逾時、5xx）視為暫時性失敗，沿用
     `notification_deliveries` 既有的 `attempts`/`lastError` 重試機制，不動
     `web_push_subscriptions.isActive`。使用者名下若沒有任何 `isActive=true` 的裝置，代表尚未
     啟用或已全部失效，直接跳過 web push 這個管道（不建立失敗紀錄），行為比照「使用者沒綁定
     Telegram 就跳過 Telegram 管道」。
   - 一個使用者可能有多台裝置各自訂閱；派送時對每個 `isActive=true` 的裝置各發一次，
     `notification_deliveries` 這筆 `channel='web_push'` 的紀錄只要有任一裝置成功即視為
     `sent`；全部裝置都失敗（且都不是 410/404 那種立即判定失效的情況）才視為這次派送 `failed`，
     交給既有重試機制下次再試。

10. **頁面**：新增 `/me/subscriptions`（我的訂閱），列出目前訂閱（label／篩選條件摘要／
    即時開關／每日摘要開關／累積命中數）、新增/編輯/刪除訂閱的表單、頁頂「啟用瀏覽器推播通知」
    開關（見交付內容 9）。bottom-tab／個人頁需有入口連到這個頁面（放在既有「我的分享」/「我的
    需要」附近，具體視當時前台導覽結構而定，由實作 session 判斷）。

11. **索引**（附加於 §11.2 既有定案索引之外，不與其衝突；`subscription_keywords
    (normalized_keyword)` 沿用 §11.2 原定索引，其用途見交付內容 5 的效能限制說明）：
    ```
    user_subscriptions(user_id)
    subscription_keywords(subscription_id)
    subscription_keywords @@unique([subscription_id, normalized_keyword])
    subscription_categories @@unique([subscription_id, category_id])
    subscription_cities @@unique([subscription_id, city_id])
    subscription_matches @@unique([subscription_id, item_id])
    subscription_matches(notified_at)        -- 每日摘要 job 撈 notifiedAt IS NULL 用
    subscription_digest_jobs @@unique([user_id, digest_date])
    web_push_subscriptions(user_id)
    web_push_subscriptions @@unique([endpoint])
    items(status, published_at, id)          -- 比對 job 掃描新上架物品的 cursor 查詢用
    ```

### 不做（scope guard）

- **不做「訂閱物主」**：訂閱的篩選條件只有關鍵字/分類/縣市，不支援「追蹤某個分享者，他一上架就
  通知我」這種對特定使用者的社交追蹤功能——這偏向社群/粉絲機制，不是「找到需要的物品」，也可能
  讓使用者感覺被特定人「盯上」，不符合平台調性。
- **不做即時 SSE/WebSocket 推播**：即時通知的「即時」上限是比對 job 的 tick 頻率（建議 5 分鐘），
  不是秒級真即時；使用者需要重新整理頁面或等下一次 job tick／Web Push 送達，與 M1 私訊 polling
  的精神一致，不為了「更即時」引入常駐連線的維運複雜度。
- **不做手機 APP push**：本平台沒有原生 iOS/Android app（§2 技術棧定案是 Next.js web），
  Web Push 只送達已安裝/開啟過該瀏覽器 PWA 權限的裝置，不做 Apple Push Notification service／
  Firebase Cloud Messaging 這類原生推播整合。
- **不做進階查詢語法**：關鍵字只支援簡單子字串 OR 比對（見交付內容 5），不支援 AND／排除詞／
  萬用字元／正規表示式這類進階語法。
- **不做建立訂閱時回填比對存量物品**：新建立的訂閱只比對「之後」新上架的物品，不會在建立當下
  對現有 `published` 物品做一次性全庫掃描比對——這與比對 job 首次上線時 cursor 起點設在上線
  當下（見交付內容 4）是同一個理由：避免任意時刻觸發一次全庫規模的掃描。
- **不做訂閱管理後台**：M2 治理後台與 M8 營運強化都還沒有訂閱相關的管理介面（例如看某個訂閱被
  濫用塞了什麼關鍵字、強制停用某使用者的訂閱），出問題時工程師需直接查 DB 手動處理，待 M2/M8
  之後視需要再補。
- **不做電子郵件送達**：每日摘要與即時通知都走既有站內通知＋ Telegram／Web Push 管道，不是一封
  獨立的 email newsletter——本平台目前沒有 SMTP/郵件發送基礎設施（§3.4 環境變數清單裡沒有郵件
  相關變數），若之後要加 email 管道，屬於獨立提案，不在 M6 範圍。
- **不做退訂免登入連結**（例如 email 裡常見的一鍵取消訂閱連結）：既然不透過 email 送達，這個
  常見的 email 退訂機制在本規格下不適用；使用者透過 `/me/subscriptions` 頁面管理訂閱即可。

### 驗收清單

- [ ] 乾淨 DB `prisma migrate deploy` 後 `user_subscriptions`／`subscription_keywords`／
      `subscription_categories`／`subscription_cities`／`subscription_matches`／
      `subscription_digest_jobs`／`web_push_subscriptions` 七張表皆存在；直接查 DB schema 確認
      `subscription_matches` 有 `unique(subscription_id, item_id)`、`subscription_keywords`
      有 `unique(subscription_id, normalized_keyword)`、`subscription_digest_jobs` 有
      `unique(user_id, digest_date)`、`web_push_subscriptions.endpoint` 有 unique 索引。
- [ ] 一個使用者已有 20 筆訂閱時，`POST /api/subscriptions` 回 422；一筆訂閱嘗試帶 6 個關鍵字
      → 422；三個篩選維度皆空 → 422。
- [ ] 正規化測試：關鍵字 `"ｉＰhone"`（全形）與 `"iphone"`（半形小寫）正規化後結果相同；一個
      物品標題為「二手 iPhone 13 出售」，訂閱關鍵字 `"iPhone"` 應該命中（子字串比對，不受
      大小寫/全形半形影響）。
- [ ] 建立一筆 `immediateEnabled=true` 的訂閱後上架一個符合條件的新物品，手動觸發
      `subscription_match_scan` job → `subscription_matches` 出現一筆 `notifiedAt` 非 null、
      `notifiedVia='immediate'`，該使用者的 `notifications` 出現一則 `subscription_match`
      通知。
- [ ] 建立一筆只開 `dailyDigestEnabled=true`（`immediateEnabled=false`）的訂閱，同樣情境下觸發
      `subscription_match_scan` → `subscription_matches` 出現一筆但 `notifiedAt` 仍是 NULL、
      當下**不**產生任何通知；再手動觸發 `subscription_daily_digest` job → 這筆才被蓋章
      `notifiedAt`/`notifiedVia='digest'`，使用者收到一則 `subscription_digest` 通知。
- [ ] Idempotency：對同一個 `(subscription, item)` 配對重複觸發 `subscription_match_scan`
      （模擬 cursor 未推進被重複觸發）→ `subscription_matches` 只有一筆（`ON CONFLICT DO
      NOTHING` 生效），不重複發通知。
- [ ] Idempotency：對同一使用者同一天重複觸發 `subscription_daily_digest` job 兩次 →
      `subscription_digest_jobs` 該 `(user_id, digest_date)` 只有一筆，第二次觸發是 no-op，
      使用者不會收到兩封當天摘要。
- [ ] 每日摘要撈到的 match 中，若對應物品已經被別人接手（`items.status` 不再是 `published`）→
      該筆仍被蓋章 `notifiedAt`（不會下次又被撈到），但不出現在摘要通知內容裡。
- [ ] 一個訂閱 `immediateEnabled=true` 且 `dailyDigestEnabled=true` 同時開啟，命中一次 match →
      只收到一次通知（即時那次），該筆 match 之後不會再被每日摘要 job 當成待通知處理。
- [ ] 通知偏好整合：使用者把 `notification_preferences` 裡 `eventType='subscription_match'`
      的 `externalEnabled` 設為關閉 → 即時比對命中時仍有站內通知，但不嘗試 Telegram/Web Push
      派送（`notification_deliveries` 不新增該筆的外部管道紀錄）。
- [ ] Web Push 端到端：前端註冊 service worker → 訂閱瀏覽器推播 → `web_push_subscriptions`
      出現一筆 `isActive=true`；觸發一次通知派送 → 該裝置實際收到系統推播通知（瀏覽器彈出）。
- [ ] 模擬 `webpush.sendNotification` 回應 410 Gone → 對應 `web_push_subscriptions` 那一筆
      立刻 `isActive=false`／`deactivatedAt` 有值；之後再次派送該使用者的通知不會再嘗試這個
      失效端點。
- [ ] 非本人對他人的 `user_subscriptions`／`web_push_subscriptions` 呼叫 `PATCH`/`DELETE` →
      403 或 404（不洩漏該筆資源是否存在）。
- [ ] `judgment-rubrics.md` §5 三組底線逐條過（比照 M1/M5 驗收慣例）。

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
