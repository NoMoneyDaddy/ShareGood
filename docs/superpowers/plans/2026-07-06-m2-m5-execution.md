# M2–M5 Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan wave-by-wave.
>
> **Scope-check note (per writing-plans skill):** M2/M3/M4/M5 are already decomposed into
> independent subsystems in `docs/plan/master-plan.md` §7–10 (每個 milestone 自帶交付內容＋驗收清單，
> 細節到資料表、索引、併發保護對照見 §11）。本檔**不重複**那份詳細規格，只負責上一層的「怎麼拆
> 成 wave、怎麼派工、依賴順序、schema 衝突怎麼避開」。每個被派工的 agent 都會被要求自己去讀
> master-plan.md 對應章節，等同這份計畫要求的「完整規格」。

**Goal:** 把 master-plan.md 的 M2（治理底線）、M3（到期與優惠券）、M4（通知強化）、M5（抽籤）
全部實作完成並合併進 main，延續 M1 已經驗證過的「schema 先行 → 功能 wave 平行派工 → 各自
review-then-merge」模式。

**Architecture:** 沿用 M1 的成功模式：
1. Schema 是單一共用檔案（`prisma/schema.prisma`），平行 agent 同時改會互撞，所以**先跑一個單一、
   循序的「schema 地基」PR**，把 M2+M3+M4 全部資料表與索引一次建好（比照 M1 當初把 handover/thanks/
   contribution 等表全部一次建在 `m1_core_loop` migration 裡的做法）。
2. Schema 地基合併進 main 後，才**平行**派工個別功能 wave（各自開 `feat/*` 分支＋isolated worktree），
   每個 wave 走「開發 → 自我驗證（build/tsc/biome/實跑）→ push → draft PR → 讀 bot review → 修真的問題
   → merge」的既有流程。
3. M5（抽籤）因為 master-plan §10 明文要求「開工前由當時的 session 先產出細部規格，經使用者確認後
   再實作」，**不能**直接進實作 wave——先派一個「規格草擬」agent 產出細部規格（交付內容＋驗收清單，
   格式比照 M0–M4），寫回 master-plan.md §10.1，然後**停下來給使用者確認**，確認後才開實作 wave。

**Tech Stack:** 沿用既有：Next.js App Router + PostgreSQL + Prisma + MinIO + Auth.js；測試用
Vitest（整合）與既有的「本機 DB 直接跑 API/DB 驗證」模式；Prisma migration 走 `migrate deploy`
（環境是非互動式，`migrate dev` 在這裡不能用，見既有教訓）。

## Global Constraints

- 每個 mutation API 必須 server-side 權限檢查（`requireUser()`/`requireRole()`）。
- 所有列表 API 必分頁（cursor-based，預設 20、上限 50）；禁止 `SELECT *`。
- 寫入去重靠 DB constraint（unique / transaction + updateMany-count），不靠前端防連點。
- 秘密只放環境變數；`COUPON_SECRET_KEY`、`TELEGRAM_BOT_TOKEN` 等 M3/M4 新增變數要回寫
  master-plan.md §3.4 環境變數清單。
- 全程繁體中文（commit 訊息、PR 說明、程式內敘述文字）；技術詞彙/程式碼/檔名維持英文。
- 每個 milestone 完成定義：該節「驗收清單」逐條有證據 + judgment-rubrics.md §5 三組底線全過。
- Commit 訊息結尾固定 Co-Authored-By/Claude-Session 那兩行；不把模型 ID 寫進 repo 內容。
- 每個 wave 的 agent 都是「唯一執行者」——不能再往下轉派給其他 subagent，必須自己做完
  開發/測試/commit/push/開 PR 全部步驟（比照 M1 各 wave 已驗證有效的派工說法，避免重演
  M1 時期發生過的「假裝已轉派給別的 subagent、其實什麼都沒做」的幻覺完成事故）。

---

## Wave 0：Schema 地基（循序、阻擋後面所有 wave）

**目標：** 一次把 M2＋M3＋M4 全部資料表、索引建好，避免平行 agent 同時改 `schema.prisma` 互撞。

**Files:**
- Modify: `prisma/schema.prisma`（新增 §11.1 列出的 M2/M3/M4 全部 model）
- Create: 一個新 migration（`prisma/migrations/<timestamp>_m2_m4_schema/migration.sql`，用
  `prisma migrate deploy` 非互動式套用，見既有教訓——`migrate dev` 在這個環境會因為
  non-interactive 直接報錯，要手動建 migration 目錄+SQL 再 `migrate deploy`）
- Modify: `.env.example`（新增 `COUPON_SECRET_KEY`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`
  空值佔位）

**Interfaces（後面 wave 會依賴的東西）:**
- M2 model：`Report`、`ReportEvidence`、`UserRestriction`、`ItemRemoval`、`SupportTicket`、
  `SupportTicketEvent`、`SupportTicketAttachment`、`Appeal`、`AppealEvidence`、`KeywordBlocklist`、
  `FeatureFlag`
- M3 model：`CouponDetail`、`CouponSecret`、`CouponRevealLog`、`ItemExpirationLog`、`SystemJob`、
  `SystemJobRun`
- M4 model：`NotificationPreference`、`NotificationDelivery`、`TelegramAccount`、
  `TelegramLinkToken`、`TelegramUpdate`
- 索引：master-plan §11.2 列出的 `reports(status, created_at)` 等全部照抄；沒列到但業務上明顯
  需要的（例如 `user_restrictions(user_id, expires_at)`）可以自行判斷加。
- 併發保護：master-plan §11.3 對照表全部照做（job lock、update_id 去重等）。

**驗收條件：**
- `npx prisma migrate deploy` 在本機乾淨套用成功。
- `npx prisma generate` 成功，`npx tsc --noEmit`／`npx biome check .`／`NODE_ENV=production npx next build`
  全過（這階段還沒有任何 route 用到新 model，純粹確認 schema 語法與既有程式碼不衝突）。
- push 到 `feat/m2-m4-schema-foundation`，開 draft PR，走完整個 bot review 流程後 merge 進 main。

---

## Wave 1（M2 治理底線，Wave 0 merge 後平行派工）

每個都是獨立 agent、獨立 worktree、獨立 `feat/m2-*` 分支，讀 master-plan.md §7：

1. **檢舉功能**：對物品/留言/私訊檢舉＋附件，狀態機 `submitted→triaged→in_progress→resolved/rejected→closed`。
2. **強制下架 + audit log**：moderator/admin 下架物品（必填原因），通知物主，寫 `audit_logs`。
3. **功能限制**：禁上架/禁留言/禁私訊/封鎖，API 層統一檢查（這支要小心別破壞 M1 既有 API 的
   權限檢查邏輯，只能是「疊加」一層新檢查，不能重寫既有 `requireUser()` 呼叫點）。
4. **使用者回報（support tickets）**：bug/帳號問題入口＋後台處理列表。
5. **申訴**：被下架/被限制者申訴一次，admin 複審。
6. **rate limit + 關鍵字黑名單 + feature flag**：DB-based 起步，`REQUIRE_REVIEW` 開關。
7. **Admin 後台最小集 `/admin`**（依賴 1–6 的資料，建議放在這幾個都有初步 API 之後才做，
   或至少最後一個派工，避免又要等又要改介面）。

## Wave 2（M3 到期與優惠券，可與 Wave 1 平行，同樣依賴 Wave 0）

讀 master-plan.md §8：
1. **優惠券子表單 + 券碼加密（AES-256-GCM）+ 揭露 log**。
2. **到期 job**（`CRON_SECRET` 保護的 route；先做「手動觸發」版本，外部 cron 串接留給使用者
   之後在 Zeabur/cron-job.org 設定，job 本身要 idempotent）。
3. **優惠券錢包 `/me/wallet`**。

## Wave 3（M4 通知強化，可與 Wave 1/2 平行，同樣依賴 Wave 0）

讀 master-plan.md §9：
1. **通知偏好頁 + `notification_preferences`**。
2. **Telegram Bot 綁定流程 + webhook（secret header 驗證、update_id 去重）**。
3. **通知合併（30 分鐘窗口）+ 每日外部通知上限**。

## Wave 4（M5 抽籤，需要使用者確認才能進實作）

1. **規格草擬 agent**（可以現在就跟 Wave 0 平行跑，不碰 schema/code，純文件）：讀
   master-plan.md §10「M5 抽籤」現有的粗綱＋§11.1/§11.3 已經定案的抽籤資料表與併發保護，
   草擬完整的 M5 細部規格（交付內容＋驗收清單，格式比照 M0–M4），寫回 master-plan.md，
   新增一節「## 5a. M5 — 抽籤（v1.1，細部規格）」。**不要動 schema.prisma、不要寫任何
   app 程式碼**，這步只產出規格文件。
2. **使用者確認關卡**：規格草擬完成後，主線程要把草稿摘要給使用者看，等明確回覆才能繼續。
   在使用者確認前，不派任何 M5 實作 agent。
3. 確認後才依前面 Wave 0→Wave N 的模式，先補 M5 專屬 schema（`lotteries` 等 4 張表，可以
   併進 Wave 0 或另開一次小型 schema PR），再派實作 agent。

---

## 執行順序總結

```
Wave 0（schema 地基，循序，阻擋 Wave 1/2/3）  ⟶ 同時 ⟶  Wave 4 步驟 1（M5 規格草擬，不依賴 Wave 0）
        │
        ├──▶ Wave 1（M2，7 個並行 agent，依賴 Wave 0）
        ├──▶ Wave 2（M3，3 個並行 agent，依賴 Wave 0）
        └──▶ Wave 3（M4，3 個並行 agent，依賴 Wave 0）

Wave 4 步驟 2（使用者確認）⟶ Wave 4 步驟 3（M5 實作，依賴使用者確認 + 專屬 schema）
```

## Self-Review（spec coverage）

- M2 交付內容 1–9（§7）→ Wave 1 的 7 個任務全部覆蓋（rate limit/黑名單/feature flag 併成一個任務，
  admin 後台獨立一個任務，共 7 個，對應 9 項交付內容——其中 schema 已挪到 Wave 0，flag 機制併入
  任務 6）。
- M3 交付內容 1–6（§8）→ Wave 2 的 3 個任務覆蓋（schema 挪到 Wave 0，即期食品規則併入優惠券
  子表單那個任務，因為兩者共用「物品加欄位」的改動範圍）。
- M4 交付內容 1–4（§9）→ Wave 3 的 3 個任務覆蓋（schema 挪到 Wave 0）。
- M5 → 依 master-plan §10 明文規定，規格草擬與確認是必要步驟，已經是 Wave 4 步驟 1–2，不能跳過。
