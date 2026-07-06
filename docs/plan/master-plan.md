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
     `keywords[]`（≤5，每個做交付內容 5 的正規化）、`categoryIds[]`、`cityIds[]`）。
     三個篩選維度（關鍵字/分類/縣市）**至少要有一個非空**，否則回 422（避免建立「什麼都比對」
     的訂閱，對比對 job 與使用者自己都是雜訊）。同一 transaction 內先數使用者目前訂閱數，
     `>= 20` 回 422（`{"error":{"code":"VALIDATION_ERROR","message":"訂閱已達上限（20 筆）"}}`）；
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
     的最後一筆 `(publishedAt, id)` 寫進這次 run 的 `detail.cursor`。
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
     unique 代表今天已經處理過這個使用者（不論成功與否都不重複跑），直接跳過——這是「同一天
     不重複發送摘要」的 idempotency 機制，即使 job 因故被重複觸發也不會對同一使用者發兩封。
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
     `notificationclick` 事件，`clients.openWindow(event.notification.data.itemUrl)`（優先
     focus 既有分頁，沒有才開新分頁）。
   - **前端註冊流程**：`/me/subscriptions` 頁頂端提供「啟用瀏覽器推播通知」開關 →
     `navigator.serviceWorker.register('/sw.js')` → 使用者同意瀏覽器通知權限提示 →
     `registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:
     <WEB_PUSH_VAPID_PUBLIC_KEY 轉成的 Uint8Array>})` → 拿到的 `PushSubscription` 呼叫
     `POST /api/web-push/subscriptions` 存進 `web_push_subscriptions`。
   - **失效偵測與自動清理**（比照 M4 Telegram「發送失敗重試＋失效自動解綁」的精神，Web Push 的
     失效訊號比 Telegram 更明確——是標準化的 HTTP 狀態碼，不需要額外偵測邏輯）：發送時用
     `webpush.sendNotification(subscription, payload, {vapidDetails})`；回應
     **404/410（Gone）代表該裝置的推播訂閱已在瀏覽器端失效**（使用者關閉了通知權限、清除瀏覽器
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
