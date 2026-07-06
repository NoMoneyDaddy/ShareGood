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
- [x] M2 治理底線：範圍見 master-plan.md §7，跟 M1 一樣分段 commit／push。7 個交付內容全部完成。
    - [x] 檢舉（PR #28）：對物品/留言/私訊三選一檢舉＋最多 3 張證據圖片，
          狀態機 `submitted→triaged→in_progress→resolved/rejected→closed`（跳過中間態或逆向
          轉換一律 409，resolved/rejected 結案必填處理備註）；`POST/GET /api/reports`、
          `PATCH /api/reports/[id]`（moderator/admin）、`POST /api/reports/attachments`
          （沿用 §3.3 圖片管線，只產生單一 webp 變體，`kind` 固定 `report_attachment`）；
          證據圖片沿用 `POST /api/items` 的「uploaderId+status=pending」原子 updateMany
          搶用防呆；私訊檢舉會檢查檢舉人是否為該 conversation 成員（非成員一律 404，不洩漏
          conversation 存在）；一般使用者 `GET /api/reports` 只看得到自己的檢舉，
          `?scope=all` 限 moderator/admin。前端接上物品詳情頁（檢舉物品）、留言列表
          （檢舉他人留言，`claims-section.tsx` 順手把 `GET .../claims` 回應加了
          `userId` 欄位方便前端判斷是不是自己的留言）、私訊對話串（檢舉他人訊息）
          共用的 `src/components/report-button.tsx`。
    - [x] 強制下架（PR #24）：`PATCH /api/items/[id]/force-remove`（moderator/admin，必填原因，
          寫 `ItemRemoval`／`ItemStatusLog`／`AuditLog`，通知物主）、`GET /api/items/[id]/removal`
          （查詢下架紀錄，僅物主與 moderator/admin 可見，其他人 404）。
    - [x] 功能限制（PR #29）：對使用者禁上架/禁留言/禁私訊（可設期限）、封鎖（全站唯讀，
          擋所有 mutation API）；`checkUserRestriction`／`checkFullBlock` 疊加進既有
          上架/留言/私訊/直贈/交接/感謝/通知偏好/上傳等全部 mutation 端點；
          `POST/DELETE /api/admin/user-restrictions[...]`（moderator/admin 管理，RBAC 邊界、
          audit log、同一使用者同類型限制不能重複建立——用 Postgres advisory lock 擋併發
          建立的競態）。
    - [x] 使用者回報 support tickets（PR #35）：`/support`（前台送出，bug/帳號問題/其他，
          附最多 3 張截圖）、`/support/[id]`（本人與 moderator/admin 共用，含留言與狀態機）、
          `/admin/support-tickets`（後台列表，依狀態/認領情形篩選）、
          `POST/GET/PATCH /api/support-tickets[...]`。
    - [x] 申訴（PR #26）：被下架/被限制者對自己名下的紀錄申訴一次（`Appeal.itemRemovalId`/
          `userRestrictionId` 皆為 `@unique` 擋重複），admin 複審核准時原子復原
          （物品轉回 `published` 或 `UserRestriction.liftedAt`），`GET /api/appeals?scope=all`
          給 admin 查全站待複審佇列。
    - [x] rate limit + 關鍵字黑名單 + feature flag（PR #31）：DB-based rate limit（上架/留言/
          私訊/上傳/檢舉各自時窗上限，超過 429）、關鍵字黑名單攔上架標題/描述與留言內容
          （422）、`REQUIRE_REVIEW` feature flag（開啟後新物品先進 `pending_review`，
          物品詳情頁對非物主一律 404、不產生 SEO metadata）。
    - [x] Admin 後台最小集（PR #37）：`/admin` 首頁（moderator/admin 限定，其餘 404，比照
          `/admin/support-tickets` 既有寫法）顯示待辦總覽三個數字（未處理檢舉／待處理回報／
          待複審申訴，直接查 db 算），並連到各子頁；`/admin/reports`＋`reports-panel.tsx`
          （檢舉列表＋狀態機操作，呼叫既有 `GET /api/reports?scope=all`／
          `PATCH /api/reports/[id]`）；`/admin/appeals`＋`appeals-panel.tsx`（申訴複審，
          刻意收窄成 **admin-only**，因為既有 `GET /api/appeals?scope=all` 本來就只有 admin
          看得到全站待審佇列，讓 moderator 進來只會看到誤導性空清單，呼叫既有
          `GET/PATCH /api/appeals[/:id]`）；`/admin/items`＋`force-remove-form.tsx`
          （物品搜尋＋非終態物品可強制下架，呼叫既有 `PATCH /api/items/[id]/force-remove`，
          沒有現成的後台物品搜尋 API 所以直接查 db，比照 `/admin/support-tickets` 慣例）；
          `/admin/users`＋`restriction-panel.tsx`（使用者搜尋＋建立/解除限制，呼叫既有
          `POST/DELETE /api/admin/user-restrictions[...]`，同樣直接查 db 搜尋）；
          `/admin/audit-logs`（稽核紀錄唯讀查詢，依 targetType/targetId 篩選）；
          `admin-nav.tsx` 共用頂部導覽，補進既有的 `/admin/support-tickets`；
          `site-header.tsx` 新增「後台管理」入口（moderator/admin 可見）避免整批頁面變成
          孤兒頁。E2E 整合測試 `e2e/integration/admin-dashboard.test.ts` 涵蓋權限邊界
          （404/200）、待辦總覽數字正確 +1、物品搜尋＋強制下架後表單消失＋稽核紀錄查得到、
          使用者搜尋＋建立/解除限制、site-header 入口可見性；`npx biome check .`／
          `npx tsc --noEmit`／`NODE_ENV=production npx next build`／
          `npx vitest run --config vitest.config.ts`（14 個測試檔 106 個測試）全過。
- [x] M3 到期與優惠券（PR #34）：範圍見 master-plan.md §8。優惠券／即期食品子表單接在
      `/items/new`，`POST /api/items` 驗證額外欄位並用 AES-256-GCM 加密券碼存
      `CouponSecret`；`POST /api/items/[id]/coupon/reveal`（僅交接確定後的接手者能看明文，
      每次揭露寫一筆 `CouponRevealLog`，刻意不去重）；`POST /api/jobs/item-expiration`
      （`CRON_SECRET` 保護，`published` 且到期轉 `expired`／到期前 3 天提醒，
      `ItemExpirationLog` 的 unique(itemId, action) 保 idempotent，物品若已離開
      `published`（例如剛好被認領）不會被誤轉態）；`/me/wallet`（分列已分享/已接手的
      優惠券）；`GET /api/items?sort=expiring` 排序加權。
- [x] M4 通知強化：範圍見 master-plan.md §9，4 項交付內容全部完成。
    - [x] 通知偏好頁（PR #25）：`GET/PATCH /api/notification-preferences`、
          `/me/notification-preferences`（每類事件各自控制站內/外部通知開關）。
    - [x] Telegram Bot 綁定 + webhook（PR #27）：`POST /api/telegram/link-token`（一次性
          綁定 token）、`POST /api/telegram/webhook`（secret header 驗證 + update_id 去重
          + `/start` 綁定）、`DELETE /api/telegram/account`（主動解綁）。實際「發送外部通知」
          與通知偏好檢查串接留待之後接上 `shouldSendExternalNotification`（見下一項）。
    - [x] 通知合併與每日外部通知上限（PR #33）：`createOrMergeNotification`（同一使用者/
          物品/事件類型在 30 分鐘窗口內合併成一筆未讀通知，`payload.mergedCount` 累加，
          已知限制：`findFirst`+`update` 非原子操作，極端併發下理論上可能各自建立一筆，
          現階段流量下風險極低、暫不處理，見程式碼註解）、`shouldSendExternalNotification`
          （每人每日外部通知上限預設 20，只影響外部發送判斷、不影響站內通知）。
- [x] M5 抽籤（PR：feat/m5-lottery）：範圍見 master-plan.md §5a，schema 地基已在 PR #36
      merge 進 main（`Lottery`／`LotteryEntry`／`LotteryResult`／`LotteryAuditLog` 四表，
      本次未動 `prisma/schema.prisma` 任何一行）。`POST/GET /api/items/[id]/lottery`
      （物主開抽籤／查詢狀態）、`POST/DELETE /api/items/[id]/lottery/entries`（報名／
      取消報名，`@@unique([lotteryId,userId])` 擋併發重複報名）、`PATCH /api/lotteries/
      [id]/{cancel,confirm,decline}`；`POST /api/jobs/lottery-draw`（沿用 M3 的
      `system_jobs`／`CRON_SECRET` 模式，每次執行處理「到期開獎」與「逾時遞補」兩件事，
      逐筆用 `lotteries.status`／`lottery_results.status` 的條件式 `updateMany` 當樂觀鎖，
      重複觸發或多 worker 同時執行皆 idempotent）；開獎演算法與遞補共用邏輯集中在
      `src/lib/lottery.ts`（`deterministicShuffle` 用 `crypto.randomBytes` 產生種子＋
      HMAC-SHA256 決定性 Fisher-Yates 洗牌，可重演驗證）。物品在整場抽籤期間全程維持
      `published`，僅在得主 `confirm` 的同一 transaction 內轉 `reserved`；`claims`／
      `direct-shares` 兩支既有 API 新增一段非終態抽籤時回 409 的檢查，其餘不變。
      **銜接既有交接流程的實作筆記**：`confirm` 端點會順手補寫一筆
      `ClaimComment`（`status=accepted`），讓完全不修改的既有
      `POST /api/items/[id]/handover/ensure`（靠 `acceptedClaim`/`acceptedDirectShare`
      找接手者）能認得出抽籤產生的配對——這不是新發明的資料表或欄位，只是借用 M1
      既有的查詢管道；因為物品在抽籤期間全程 `published`、且 `published` 狀態下依
      `claims/route.ts` 的邏輯不可能存在任何既有 `ClaimComment`，這筆插入不會撞到
      `@@unique([itemId,userId])`。物品詳情頁新增 `lottery-section.tsx`（比照
      `thanks-section.tsx`／`handover-section.tsx` 拆分慣例），`claims-section.tsx`／
      `direct-share-section.tsx` 新增 `lotteryActive` prop 在抽籤進行中提前隱藏表單。
      通知沿用 M1 站內通知機制、重用 `completion_confirmed` type＋`payload.kind`
      判別欄位（`lottery_won`／`lottery_drawn`／`lottery_backup_offered`／
      `lottery_progress`／`lottery_failed`／`lottery_cancelled`），比照 M2 強制下架、
      M3 到期 job 的既定做法，不新增 `NotificationType` enum 值。整合測試
      `e2e/integration/lottery.test.ts`（15 案例：建立/互斥、報名併發、開獎併發＋
      重演驗證、逾時遞補、婉拒遞補、候補用盡流標、確認＋貢獻值＋交接銜接、取消抽籤、
      稽核時間序），連同既有 13 支整合測試共 115 個案例全過。
- [x] M6 訂閱通知＋Web Push（PR：feat/m6-subscriptions-webpush）：範圍見 master-plan.md
      §6a，schema 地基已在 PR #36 merge 進 main（`UserSubscription`／`SubscriptionKeyword`／
      `SubscriptionCategory`／`SubscriptionCity`／`SubscriptionMatch`／`SubscriptionDigestJob`／
      `WebPushSubscription` 等表，本次未動 `prisma/schema.prisma`）。訂閱條件 CRUD：
      `POST/GET /api/subscriptions`、`GET/PATCH/DELETE /api/subscriptions/[id]`（關鍵字≤5／
      分類／縣市，三維度至少一項、20 筆上限、正規化去重）；Web Push 裝置訂閱
      `POST/DELETE /api/web-push/subscriptions`（依 endpoint upsert／刪除，`src/lib/web-push.ts`
      封裝 `web-push` 套件呼叫，404/410 自動停用失效裝置，多裝置推播用 `Promise.all` 平行處理
      且每個裝置的推播＋DB 更新各自獨立 try/catch，避免單一裝置失敗拖垮整批）；排程比對 job
      `POST /api/jobs/subscription-match-scan`（cursor 存 `SystemJobRun.detail`，`@@unique
      (subscriptionId,itemId)` 保 idempotent，逐 pair 呼叫外加 try/catch，單筆例外不中斷整個
      batch）與每日摘要 job `POST /api/jobs/subscription-daily-digest`（`@@unique(userId,
      digestDate)` 保同日不重複發送）；`/me/subscriptions` 頁面（表單／列表／啟用瀏覽器推播
      開關）＋ `public/sw.js` service worker。通知沿用 M1 機制、重用 `completion_confirmed`
      type＋`payload.kind`（`subscription_match`／`subscription_digest`），首次把 M4
      `notification_preferences` 的 `inAppEnabled`/`externalEnabled` 真正接進通知建立流程
      （`src/lib/subscription-notify.ts`，僅套用在這兩個新事件類型）。**關鍵前提**：
      `handover/[id]/no-show`、`appeals/[id]` 兩支既有 route 補上物品退回 `published` 時
      同步更新 `publishedAt`，否則比對 job 的 cursor 永遠掃不到重新上架的物品。整合測試
      `e2e/integration/{subscriptions,web-push}.test.ts`，連同既有套件共 153 個案例全過。
- [x] M7 資料權利與法務（PR：feat/m7-data-rights-legal）：範圍見 master-plan.md §7a，
      **技術骨架，法律相關文案上線前需律師與平台法務審閱**。自助資料匯出
      `POST/GET /api/me/data-exports`、`GET /api/me/data-exports/[id]/download`（15 分鐘
      簽名連結，每次呼叫重簽）；帳號刪除 `POST/DELETE /api/me/privacy-requests[...]`（7 天
      冷卻期可撤銷，`account_deletion_execute` job 到期執行**應用層去識別化**，`User` 資料列
      本身永不真的 `DELETE`，保留其他使用者看得到的歷史紀錄完整性，命中 legal hold 則拒絕
      執行）；`/admin/data` 可設定的 retention 政策＋`retention_purge` job（`src/lib/
      retention.ts` 的批次清理一律用 `id` 遞增游標分頁，避免整批命中 legal hold 時提前
      `break` 或陷入無窮迴圈）；`/admin/legal-holds`（admin-only）建立/解除訴訟保全，
      `isUnderLegalHold`／`filterUnderLegalHold` 批次查詢供所有清理 job 呼叫避免 N+1；
      `/admin/legal-requests`（不對外開放）警方／檢調調閱雙人審核（建檔與核准/駁回/解除
      legal hold 皆為不同 admin，且狀態轉換用 transaction 內條件式 `updateMany` 擋併發覆蓋）。
      `docs/plan/master-plan.md` §7a 列出的保留天數／去識別化欄位範圍／調閱核准層級等判斷
      皆標註「需法務確認」。整合測試 `e2e/integration/data-rights.test.ts`（15 案例），連同
      既有套件共 115 個案例全過（本機無 MinIO，`s3rver` 模擬 S3 簽章驗證端對端測試簽名連結）。
- [x] M8 營運強化（PR：feat/m8-ops-hardening）：範圍見 master-plan.md §8a，schema 地基已在
      PR #36 merge 進 main（`health_checks`／`error_logs`／`performance_metrics`／
      `storage_usage_snapshots`／`NotificationDelivery.lastAttemptAt`）。慢查詢紀錄：
      `src/lib/db.ts` 用 Prisma Client Extension 量測每次 ORM 查詢耗時寫入
      `performance_metrics`（門檻 1000ms 標記 `isSlow`），用另一個未擴充的 base client
      （`rawDb`）寫入量測結果本身避免無窮遞迴；錯誤記錄：`src/instrumentation.ts` 用
      Next.js `onRequestError` hook 全站捕捉未捕捉例外寫入 `error_logs`，只記路徑/方法，
      不記 headers/body；`/api/health` 擴充為三個獨立子系統（database／storage／
      background_jobs），**公開端點回應只留 status/latencyMs，不回傳原始例外訊息**（避免
      對外洩漏內部錯誤細節），完整 detail 寫入 `health_checks` 供 `/admin/ops`（moderator/
      admin）查詢；通知失敗指數退避重送 `src/lib/notification-retry.ts`（`min(2^attempts×
      60,3600)` 秒退避、最多 5 次，連續 3 筆失敗且符合特徵即自動解綁 Telegram 帳號）；
      四個新 job（`storage_usage_snapshot`／`health_check_probe`／`notification_retry`／
      `ops_retention_cleanup`，分批刪除避免長時間鎖表）；`/admin/ops` 後台四分頁＋6 支 API，
      皆限 moderator/admin。**已知落差**：通知重送的「初次發送」管線本來就不存在（M4 遺留
      缺口，非本次新增，本 PR 只做已存在 failed delivery 的退避重試）；本機無 MinIO，
      `storage` 健康檢查與用量快照端對端行為改測 DB 端純邏輯；備份還原 runbook
      （`docs/runbooks/backup-restore.md`）已用一次性測試資料庫實跑 `pg_dump`/`pg_restore`
      驗證成功，正式站對 Zeabur/MinIO 的首次真實季度演練仍待日後執行。整合測試
      `e2e/integration/ops-{permissions,storage-usage,notification-retry}.test.ts`，
      連同既有套件共 210 個案例中 205 個通過（5 個失敗集中在 M7 自己需要 MinIO/S3 的資料
      匯出測試，本機環境限制，非本次改動造成）。
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
