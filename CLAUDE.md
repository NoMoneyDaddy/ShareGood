# ShareGood 好物共享

台灣縣市級免費共享平台：把用不到的好物分享給需要的人。**不做金流、不做物流、不做交換、不做社區圈。**
技術棧：Next.js monolith + PostgreSQL + Prisma + MinIO + Auth.js，部署 Zeabur。與使用者對話一律用繁體中文。

## 目前階段

- [x] 制度與規格建立（本檔與 docs/ 全部檔案）
- [x] M0 Foundation：已部署 https://sharegood.nomoneydaddy.app（web/postgres/minio/redis 四服務、
      migration＋seed 已在正式站跑過、health 綠、Google OAuth 登入與 MinIO 真實上傳皆已由
      使用者在正式站實測通過）。
- [x] M1 核心共享主迴路：範圍見 master-plan.md §6，規模遠超一個 session，採分段
      commit／push，每個階段完成後在這裡更新進度。已知決策：圖片上傳要支援 iPhone 預設的
      HEIC 格式，走後端 HEIC→JPEG 轉碼（不是前端轉檔、也不是純提示訊息了事）。
    - [x] 上架（建立好物）：`POST /api/items`、`/items/new`（表單）、`/items/[id]`（詳情頁），
          首頁與底部導覽 CTA 已串接（PR #9）。
    - [x] 留言/認領（PR #13）：先到先得模式（M1 範圍簡化，不做物主手動挑人），
          `POST/GET /api/items/[id]/claims`，併發搶佔已驗證。
    - [x] 直贈（PR #10）：`POST/GET/PATCH /api/items/[id]/direct-shares[...]`，
          email 指定收禮人、lazy expiry（不搭 cron）、單一 pending 限制。
    - [x] 站內通知中心讀取端（PR #12）：`GET/PATCH /api/notifications[...]`、
          `/notifications` 頁面、site-header 鈴鐺 badge；寫入端已在留言/直贈裡各自掛上。
    - [x] SEO/AEO 補完（PR #11）：物品詳情頁 OG + JSON-LD（Product/Offer）、
          動態 `/sitemap.xml`、`robots.txt` 補 Sitemap 欄位。
    - [x] 交接與私訊（PR：feat/m1-handover）：懶建立模式 `POST /api/items/[id]/handover/ensure`
          （不動 Wave 1 留言/直贈的 accept transaction）、雙人 conversation + polling 訊息
          （`GET/POST /api/conversations/[id]/messages`）、雙方確認完成
          （`PATCH /api/handover/[id]/complete`，idempotency 已併發測試）、
          物主標記未出現（`PATCH /api/handover/[id]/no-show`，退回 published）。
          `/conversations`（我的對話列表）與 `/conversations/[id]`（對話頁）已做；
          bottom-tab 訊息分頁已接上。
    - [x] 感謝與貢獻值（PR：feat/m1-thanks-contribution）：貢獻值記分直接塞進
          `complete`／`no-show` 兩支既有 API 已驗證過的原子分支裡（分享完成 +10、接手完成
          +2、no_show -5，數值集中在 `src/lib/contribution.ts`），idempotent 保護沿用既有
          機制，已驗證重複呼叫不重複記分；`POST /api/items/[id]/thanks`（接手者單向感謝，
          一物品限一則，`ThanksMessage.itemId` 為 `@unique`，靠資料庫唯一索引擋重複、
          留言與通知包在同一個 transaction 裡）；物品詳情頁新增 `thanks-section.tsx`
          顯示感謝留言、`handover-section.tsx` 的 completed 分支給接手者留言表單；
          新增公開個人頁 `/u/[userId]` 顯示暱稱與累計貢獻值（PR #15）。
    - [x] E2E 全流程測試（PR：feat/m1-e2e-tests）：Playwright 主迴路測試
          `e2e/tests/main-loop.spec.ts`（database session 直接插 cookie 登入，繞過
          OAuth；上架用真的 API 呼叫，其餘每步都是真的瀏覽器操作）；併發／權限邊界／
          分頁與索引三支 Vitest 整合測試在 `e2e/integration/`；併發測試改成 10 個並發
          留言（原本兩個請求在本機低延遲環境幾乎每次都被第一層預先讀取擋成 409，測不到
          transaction 內 updateMany 那層 race，見 `docs/governance/lessons/`）；補上
          先前 PR 沒做的 `GET /api/items` 列表端點（cursor 分頁＋縣市/分類/關鍵字篩選，
          對齊 master-plan §11.2 索引）讓「分頁與索引」這條驗收有東西可測——**已知遺留
          缺口**：首頁 (`src/app/page.tsx`) 目前仍是 `DEMO_ITEMS` 示範資料，沒有接上這支
          新列表 API，之後要做真的物品瀏覽頁時記得接上。EXPLAIN ANALYZE 確認主查詢走
          `items_status_city_id_category_id_created_at_idx`（Index Scan，非 Seq Scan）；
          `npx biome check .`／`npx tsc --noEmit`／`NODE_ENV=production npx next build`
          全過。
- 之後每完成一個 milestone，就把上面清單勾掉並更新。

## 路由表：何時讀哪份檔案

| 情境 | 讀這份 |
|---|---|
| 任何開發任務開工前（必讀） | `docs/plan/master-plan.md`（唯一主控規格，讀目前 milestone 那節＋通用慣例 §3＋附錄 §11 該 milestone 條目） |
| 要派 subagent、選 model/effort | `docs/governance/model-dispatch.md` |
| 拿不準「算不算完成／該不該問使用者／要不要換路」 | `docs/governance/judgment-rubrics.md` |
| 要寫派工 prompt | `docs/governance/delegation-templates.md`（直接複製模板填空） |
| 想修改制度檔或計畫書 | `docs/governance/maintenance-protocol.md`（先讀，有分級授權） |
| session 開場、或接手交接 | `docs/governance/letter-to-future-sessions.md` ＋ `docs/governance/lessons/README.md` |
| 想了解 harness 常見失敗模式 | `docs/governance/diagnosis.md` |
| 寫任何 Next.js 程式之前 | `AGENTS.md`（本版 Next.js 與訓練資料有差異，先讀它指向的官方 docs） |

`docs/plan/original-master-plan-v1.md` 是歷史備份，僅供考古，**不要**照它執行。

## 硬規則（不可違反；其餘細則在上表對應檔案裡）

1. **指揮官不下場**：預估要讀超過 3 個檔案、或單檔超過 400 行、或任何網頁 → 派 subagent（Explore 或
   general-purpose），要求只回結論與 file:line。例外：接下來要 Edit 的檔案自己 Read。
2. **派工帶三件套**：目標與動機、驗收條件、回報格式。缺一不派。
3. **驗證不自驗**：驗收派 fresh-context subagent；檔案用 read-back、程式碼用測試或實跑。
   沒有證據（測試輸出／指令結果／file:line）的「已完成」一律視為未完成。
4. **隨做隨 commit**：每完成一個可交付單位立即 commit（conventional 前綴：feat/fix/docs/…）。
   功能開發在 `feature/*` 分支、push 後開 draft PR 給使用者過目；純文件小改可直接進 `main`。
   一個 session 只做一個 milestone 的工作，做完驗收、push 後結束。
5. **踩坑就落檔**：同一問題重試或修改超過 5 次工具呼叫才解掉的（約半小時工作量），解掉後立即
   寫一課進 `docs/governance/lessons/`；拿不準要不要寫，就寫。
6. **安全底線**（寫程式碼時）：所有 mutation API 必須 server-side 權限檢查；圖片與大檔案不進
   PostgreSQL；所有列表查詢必分頁；秘密只放環境變數。細節見 master-plan.md 通用慣例節。
7. **全程繁體中文**：對使用者輸出的所有文字（含過程敘述、簡短確認詞、commit 訊息以外的說明）
   一律繁體中文，不夾雜英文插入語（例如不要用 "Good,"、"Confirmed"、"Let's..." 開頭再接中文）。
   技術詞彙、程式碼、指令、檔名保持原文即可，但銜接的敘述文字要是中文。
8. **全站時區用台北時間**：伺服器 `TZ=Asia/Taipei`（見 master-plan §3.4 環境變數清單），
   時間顯示不用 UTC 或使用者瀏覽器時區。
