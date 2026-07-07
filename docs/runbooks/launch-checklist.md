# 正式上線設定 Runbook（launch checklist）

> 盤點基準：main `16f762f`（2026-07-07）。所有結論皆以程式碼實際行為為準，附 file:line 證據。
> 使用方式：由上往下逐項打勾。每項都有「做什麼／怎麼做／怎麼確認成功」。
> 正式站網域：`https://sharegood.nomoneydaddy.app`。全站時區 `Asia/Taipei`（CLAUDE.md 硬規則 8）。

---

## 1. 環境變數全清單

程式碼中所有 `process.env.*`（排除 `src/generated/` 產生碼與 e2e 測試專用變數）盤點如下。
「M0 已設定」欄位依據：M0 部署時 health 綠燈、Google OAuth 登入與 MinIO 上傳皆已在正式站實測通過，
代表資料庫、Auth.js、MinIO 三組變數當時已設定完成。

### 1.1 M0 時代應已設定（上線前逐一核對即可）

| 變數 | 用途 | 使用位置 | 缺了會怎樣 |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL 連線字串 | `src/lib/db.ts:11`、`prisma/seed.ts:6` | 啟動即失敗 |
| `AUTH_SECRET` | Auth.js v5 session 簽章金鑰（Auth.js 內部讀取，程式碼不直接引用） | `.env.example:8` | 登入功能整個失效 |
| `AUTH_URL` | 站台對外網址；兼作 SEO `metadataBase` 與 sitemap 網域 | `src/app/layout.tsx:16`、`src/lib/site.ts:5` | OG 絕對網址組不出來（見 §1.4 注意事項） |
| `AUTH_TRUST_HOST` | 反向代理（Zeabur）環境必設 `true` | `.env.example:10` | Auth.js 拒絕信任 host header，OAuth 失敗 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth 用戶端（Auth.js v5 自動讀取 `AUTH_*` 前綴） | `src/auth.ts:9`（provider 未傳參數＝走環境變數慣例） | Google 登入失敗 |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | MinIO 後端 SDK 連線（內網用） | `src/lib/storage.ts:13-25` | 上傳／健康檢查 storage 子系統失敗 |
| `S3_PUBLIC_URL` | 圖片公開網址前綴（含 bucket 路徑），同時餵給 `next/image` 白名單 | `src/lib/storage.ts:44`、`next.config.ts:9` | 圖片全破圖；`next/image` 明確報 hostname 未設定 |

- [ ] 上述變數在 Zeabur 正式站逐一核對存在且值正確。

### 1.2 上線前必須新增（M0 之後各里程碑新增的差集）

| # | 變數 | 里程碑 | 必填？ | 用途／使用位置 | 缺了會怎樣 | 產生方式 |
|---|---|---|---|---|---|---|
| 1 | `CRON_SECRET` | M3 起 | **必填** | 全部 15 支 `/api/jobs/*` 的 Bearer token 驗證（`src/lib/system-jobs.ts:8`；舊寫法如 `src/app/api/jobs/item-expiration/route.ts` inline 比對，邏輯相同：缺值或不符一律 401） | 所有背景 job 無法觸發：物品不會到期、抽籤不開獎、通知不外送 | `openssl rand -hex 24` |
| 2 | `COUPON_SECRET_KEY` | M3 | **必填** | AES-256-GCM 加密優惠券券碼（`src/lib/coupon-crypto.ts:13-24`，**有長度檢查：必須正好 64 個 hex 字元＝32 bytes**，不符即丟 `CouponCryptoConfigError`） | 上架優惠券／揭露券碼時 500 | `openssl rand -hex 32`（**一旦有正式資料就不能再換**，換了舊券碼全部解不開） |
| 3 | `TELEGRAM_BOT_TOKEN` | M4 | 必填（要用 Telegram 通知才需要） | 呼叫 Bot API 發訊息（`src/lib/telegram.ts:57`） | 外部通知 Telegram 通道靜默失敗（回失敗結構、不丟例外） | 向 @BotFather 建 bot 取得 |
| 4 | `TELEGRAM_WEBHOOK_SECRET` | M4 | 同上 | webhook 來源驗證，比對 `x-telegram-bot-api-secret-token` header（`src/app/api/telegram/webhook/route.ts:11,38-48`，未設直接回 500） | `/start` 綁定整個失效 | `openssl rand -hex 32`，並同值註冊進 `setWebhook`（見 §3.1） |
| 5 | `TELEGRAM_BOT_USERNAME` | M4 | 同上 | 組綁定深連結 `https://t.me/<username>?start=<token>`（`src/lib/telegram.ts:18`） | 綁定入口連結壞掉 | bot 的 @username（不含 @） |
| 6 | `WEB_PUSH_VAPID_PUBLIC_KEY` | M6 | 必填（要用瀏覽器推播才需要） | 前端訂閱用公鑰，由伺服器元件直接讀取傳入（`src/app/(shell)/me/subscriptions/page.tsx:80`、`src/lib/web-push.ts:18`） | 推播啟用鈕失敗且**無明確錯誤提示**（`src/lib/web-push.ts` 只回 `anySuccess:false`） | `npx web-push generate-vapid-keys` 一次產生公私鑰對 |
| 7 | `WEB_PUSH_VAPID_PRIVATE_KEY` | M6 | 同上 | 伺服器端簽章（`src/lib/web-push.ts:19`） | 同上 | 同上（私鑰絕不進前端） |
| 8 | `WEB_PUSH_VAPID_SUBJECT` | M6 | 同上 | VAPID subject（`src/lib/web-push.ts:20`） | 三者缺一 `ensureVapidConfigured()` 回 false，推播全停 | 格式 `mailto:<站方聯絡信箱>`（規範要求） |
| 9 | `ADMIN_EMAIL` | M0/M2 | **必填**（要有 admin 後台就必填） | 該 email 每次登入自動 upsert admin 角色（`src/auth.ts:21`） | 沒有任何 admin，`/admin` 全域 404、申訴複審無人能做 | 填站長 Google 帳號 email（若 M0 已設，核對即可） |
| 10 | `DEAL_STALE_THRESHOLD` | M9 | 選填 | 好康失效回報自動轉 stale 門檻（`src/lib/deal-info.ts:49-53`，未設預設 3；設 0/1 視為停用） | 用預設 3，無事 | 不設即可 |
| 11 | `TZ` | 全站 | **必填** | 伺服器時區（`.env.example` 末段；CLAUDE.md 硬規則 8） | 到期判斷、每日摘要、日期顯示全部偏移 8 小時 | 固定 `Asia/Taipei` |

其餘出現的 `NODE_ENV`（`src/lib/db.ts:18,71`）與 `NEXT_RUNTIME`（`src/instrumentation.ts:17`）由 Next.js 框架自動提供，不需手動設定；`E2E_BASE_URL` 僅測試用。

- [ ] 上表 #1、#2、#9、#11 四個必填變數已在 Zeabur 設定。
- [ ] Telegram 三變數（#3-5）已設定（若決定上線即開 Telegram 通知）。
- [ ] VAPID 三變數（#6-8）已設定（若決定上線即開瀏覽器推播）。
- [ ] 所有密鑰值已另行抄存到密碼管理工具（尤其 `COUPON_SECRET_KEY` 遺失即災難）。

### 1.3 怎麼確認成功

- [ ] 重新部署後 `curl -s https://sharegood.nomoneydaddy.app/api/health` 回 200（見 §5.2）。
- [ ] 上架一件「優惠券」分類測試物品成功（驗 `COUPON_SECRET_KEY` 長度正確）。
- [ ] 任挑一支 job 用 `CRON_SECRET` 打一次回 200（見 §2）。

### 1.4 注意事項

- `src/app/layout.tsx:16` 的 `metadataBase` 完全依賴 `AUTH_URL`；而 `src/lib/site.ts:5` 另有寫死的
  fallback。**務必確認正式站 `AUTH_URL=https://sharegood.nomoneydaddy.app`**，否則 OG image 用
  相對路徑組絕對網址時會出錯，兩處行為也會不一致。

---

## 2. 背景 job（cron）全清單

全部 15 支，授權機制一致：`Authorization: Bearer <CRON_SECRET>`，缺值或不符回 401
（共用 helper `src/lib/system-jobs.ts:6-9`；M8 前的 job 為等價 inline 寫法）。

通用呼叫範例（把 `<job-name>` 換成路徑名）：

```bash
curl -sf -X POST "https://sharegood.nomoneydaddy.app/api/jobs/<job-name>" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### 2.1 排程總表

「台北時間」為業務上希望的執行時刻；「UTC cron」是給以 UTC 運算的排程器（GitHub Actions）用的換算值（台北＝UTC+8，無夏令時間）。分鐘級間隔不受時區影響。

| Job（`/api/jobs/…`） | 用途一句話 | 頻率（台北） | UTC cron | 冪等性依據 |
|---|---|---|---|---|
| `notification-dispatch` | 外部通知（Telegram/Web Push）初次發送 outbox 掃描 | 每 2 分鐘 | `*/2 * * * *` | `NotificationDelivery` `@@unique(notificationId, channel)` create-to-claim，撞 P2002 跳過（`src/lib/notification-dispatch.ts:183-204`）；watermark 防首跑灌爆（route.ts:15-21） |
| `health-check-probe` | 探測 database／storage／background_jobs 三子系統寫入 `health_checks` | 每 5 分鐘 | `*/5 * * * *` | 純取樣寫入，天然安全（route.ts:13-23，註解建議 5 分鐘） |
| `notification-retry` | 失敗通知指數退避重送＋Telegram 失效自動解綁 | 每 5 分鐘 | `*/5 * * * *` | 依 `attempts`＋`lastAttemptAt` 退避判斷（`src/lib/notification-retry.ts:22-29`）；解綁用條件式 `updateMany`（同檔 76-80） |
| `subscription-match-scan` | 新上架物品比對訂閱條件、建立通知 | 每 5 分鐘 | `*/5 * * * *` | `SubscriptionMatch` `@@unique(subscriptionId, itemId)` 撞 P2002 跳過（route.ts:220-225）；cursor 存 `SystemJobRun.detail`（route.ts:54-59） |
| `data-export-generate` | 產生使用者資料匯出包上傳 MinIO | 每 10 分鐘 | `*/10 * * * *` | `dataExport.updateMany({where:{status:"pending"}})` 樂觀鎖（route.ts:39-43） |
| `lottery-draw` | 抽籤到期開獎＋逾時遞補 | 每 15 分鐘 | `*/15 * * * *` | `lotteries.status`／`lottery_results.status` 條件式 `updateMany` 樂觀鎖（`src/lib/lottery.ts`，route.ts:16-18 註解） |
| `deal-info-expiration` | 好康資訊硬性 TTL 到期轉態 | 每小時 | `0 * * * *` | 單一批次條件式 `updateMany`，轉態後不再命中 where（route.ts:27-33） |
| `storage-usage-snapshot` | 每日 storage 用量快照＋DB/MinIO 一致性交叉驗證 | 每日 01:00 | `0 17 * * *` | 每次 `create` 一筆歷史快照，重複執行只是多一筆（`src/lib/storage-usage.ts:144-153`） |
| `item-expiration` | 券／即期食品到期轉 `expired`＋到期前 3 天提醒 | 每日 02:00 | `0 18 * * *` | `ItemExpirationLog` `@@unique(itemId, action)` 撞 P2002 視為已處理（route.ts:151-160）；轉態帶 `status:"published"` 條件（route.ts:83-89） |
| `storage-cleanup` | 清 48 小時仍 pending 的孤兒 MinIO 物件 | 每日 03:00 | `0 19 * * *` | 覆寫同一終態＋刪除容錯，重複執行無害（route.ts:39-42） |
| `account-deletion-execute` | 冷卻期到期執行帳號去識別化（legal hold 擋下） | 每日 03:20 | `20 19 * * *` | `privacyRequest.updateMany({where:{status:"cooling_off"}})` 樂觀鎖（route.ts:52-57） |
| `data-export-purge` | 清逾期資料匯出包 | 每日 03:30 | `30 19 * * *` | `dataExport.updateMany({where:{status:"ready"}})` 樂觀鎖（route.ts:62-66） |
| `ops-retention-cleanup` | 清 `performance_metrics`(30d)／`error_logs`(90d)／`health_checks`(30d) | 每日 04:00 | `0 20 * * *` | 純刪除過期列，天然冪等（route.ts:13-17） |
| `retention-purge` | 依 `/admin/data` retention 政策批次清理 | 每日 04:30 | `30 20 * * *` | id 遞增游標＋where 排除已處理（`src/lib/retention.ts:124-162`）；**已知限制**：`messages_after_completion` 歸檔不去重，重複執行會多寫稽核列（`src/lib/retention.ts:403-406`，不壞資料） |
| `subscription-daily-digest` | 每日彙整訂閱比對成單一摘要通知 | 每日 08:00 | `0 0 * * *` | `SubscriptionDigestJob` `@@unique(userId, digestDate)` 撞 P2002 視為當日已發（route.ts:150-163） |

### 2.2 Zeabur 上怎麼掛

**Zeabur 目前沒有原生 cron 排程功能**（2026-07-07 查證官方文件 https://zeabur.com/docs/en-US ，導覽無 cron 章節；PHP 指南的官方建議是「另開一個常駐 worker 服務」）。可行做法擇一：

**方案一（建議首選）：GitHub Actions scheduled workflow**——免費、與 repo 同版控、`workflow_dispatch` 可手動補跑。

1. `CRON_SECRET` 存進 GitHub repo → Settings → Secrets and variables → Actions。
2. 建 `.github/workflows/cron-jobs.yml`，`on.schedule` 列出上表全部 UTC cron 表達式，各 job 用 `if: github.event.schedule == '<cron>'` 分流，步驟就是上面的 curl（加 `-sf` 讓非 2xx 造成 workflow 失敗、看得到紅燈）。
3. 注意：GitHub Actions 排程是「盡力而為」，尖峰可能延遲數分鐘；本平台無金流、可接受。

**方案二：cron-job.org**——GUI 免寫 YAML，Schedule 可直接選 Asia/Taipei 時區（免換算 UTC）。每支 job 建一筆：URL＋Method `POST`＋Advanced → Request headers 加 `Authorization: Bearer <CRON_SECRET>`，共 15 筆。

**方案三：Zeabur template 市集自架排程器**——Crontab UI（https://zeabur.com/templates/C2P5BS ，記得設 `BASIC_AUTH_USER`/`BASIC_AUTH_PWD`）或 Cronicle（https://zeabur.com/templates/R3TXYS ）。留在平台內但要多養一個服務。

- [ ] 選定方案並掛上全部 15 支 job。
- [ ] 上線日手動把 15 支各打一輪，全部回 200（冪等性有保障，手動先跑不會壞事）。
- [ ] 隔天到 `/admin/ops` 看 `system_job_runs` 各 job 都有新紀錄（某支超過排程週期 2-3 倍沒新 run＝排程器掛了）。

---

## 3. 外部服務設定步驟

### 3.1 Telegram Bot webhook

做什麼：把正式站註冊為 bot 的 webhook，讓 `/start` 綁定與通知推送運作。

程式碼行為：驗證 header `x-telegram-bot-api-secret-token`（`src/app/api/telegram/webhook/route.ts:11`），與 `TELEGRAM_WEBHOOK_SECRET` 常數時間比對，缺 header 403、缺環境變數 500（route.ts:38-48）；`update_id` 唯一鍵去重（route.ts:55-65）；`/start <token>` 用 transaction 內 `updateMany({consumedAt: null})` 原子搶佔（route.ts:121-125）。

怎麼做：

```bash
# 1) 產生 secret 並設進 Zeabur 環境變數 TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32

# 2) 註冊 webhook（Telegram 會在之後每次呼叫帶 X-Telegram-Bot-Api-Secret-Token header）
curl -s -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://sharegood.nomoneydaddy.app/api/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET 的值>"}'
```

怎麼確認成功：

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

- [ ] `getWebhookInfo` 的 `url` 正確、無 `last_error_message`。
- [ ] 實測：站內 `/me/notification-preferences` 產生綁定連結 → Telegram 點開送 `/start <token>` → 收到「綁定成功」訊息，`TelegramAccount` 多一筆 `isActive=true`。

### 3.2 Google OAuth redirect URI

程式碼行為：Auth.js v5（`next-auth@5.0.0-beta`，`src/auth.ts:9` 的 `providers:[Google]` 走 `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` 環境變數慣例），callback 固定為 `/api/auth/callback/google`。

- [ ] Google Cloud Console → API 和服務 → 憑證 → OAuth 2.0 用戶端 →「已授權的重新導向 URI」含
      `https://sharegood.nomoneydaddy.app/api/auth/callback/google`（M0 已實測過，核對即可）。
- [ ] 用 `ADMIN_EMAIL` 那個帳號登入一次，確認 `/admin` 進得去（`src/auth.ts:19-27` signIn event 自動賦 admin）。

### 3.3 MinIO `S3_PUBLIC_URL`

程式碼行為：`publicUrl(key)` 直接組 `${S3_PUBLIC_URL}/${key}`、無簽名＝永久公開網址（`src/lib/storage.ts:42-45`）；`next.config.ts:9-39` 把這個網域（含 pathname 前綴）納入 `next/image` 白名單，涵蓋 `/images/**` 與 `/support-attachments/**`。OG image 與 JSON-LD 也用這個網址。

注意事項：

- 必須是**對外可存取的 HTTPS** 網址（社群爬蟲抓 OG image、瀏覽器混合內容政策）。
- MinIO bucket 對 `images/` 前綴設匿名唯讀（`GetObject`）；後端寫入仍走 `S3_ACCESS_KEY` 認證。
- path-style 慣例下值通常帶 bucket 名（例：`https://minio-xxx.zeabur.app/sharegood`）。

- [ ] `curl -I "<S3_PUBLIC_URL>/images/<任一既有 key>"` 從外部網路回 200。
- [ ] 正式站上傳一張圖、詳情頁正常顯示（無 next/image hostname 錯誤）。

### 3.4 Web Push VAPID

程式碼行為：三個變數缺一即 `ensureVapidConfigured()` 回 false、推播全停（`src/lib/web-push.ts:18-23`）；公鑰由伺服器元件直接讀 env 傳給前端（`src/app/(shell)/me/subscriptions/page.tsx:80`），**不需要 `NEXT_PUBLIC_` 變數**，設定後重新部署即生效；404/410 自動停用失效裝置。

```bash
npx web-push generate-vapid-keys
# 把 Public Key / Private Key 分別填入 WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY
# WEB_PUSH_VAPID_SUBJECT 填 mailto:<站方聯絡信箱>
```

- [ ] `/me/subscriptions` 點「啟用瀏覽器推播」→ 允許權限 → 顯示已啟用，`WebPushSubscription` 多一筆 `isActive=true`。
- [ ] 觸發一次訂閱比對（建一筆訂閱條件＋上架一件符合的物品＋手動打 `subscription-match-scan` 與 `notification-dispatch`），裝置收到系統通知。

---

## 4. 上線決策開關

### 4.1 `REQUIRE_REVIEW`（新物品先審後上）→ **建議：關（維持預設）**

- 現況：查 `feature_flags` 表，**無資料列時預設關閉**（`src/lib/feature-flags.ts:16-19`；`src/app/api/items/route.ts:314-315` 決定 `pending_review` 或 `published`）。seed 不預建這筆 flag，所以什麼都不做＝關閉。
- 開啟後影響：非物主看詳情頁一律 404、不產 SEO metadata（`src/app/(shell)/items/[id]/page.tsx:62-66,89`）。
- **關鍵理由：目前沒有審核佇列 UI**——開啟後 moderator 只能直接改資料庫放行，會把所有正常使用者卡死在「上架了卻看不到」。免費贈物平台下游風險低，且已有關鍵字黑名單（422 攔截）、檢舉、強制下架、rate limit 多道防線。若上線後真有惡意內容潮，先補審核佇列 UI 再開。
- [ ] 確認 `feature_flags` 表無 `REQUIRE_REVIEW` 列（或 `enabled=false`）。

### 4.2 Rate limit（登入使用者 per-user）→ **建議：維持現值**

現值（`src/lib/rate-limit.ts:21-33`）：上架 5/時、20/日；留言 20/時、100/日；私訊 60/時、300/日；上傳 60/時、300/日（一次 POST 記 2 筆，實際約半數）；檢舉 10/時、30/日；好康投稿 10/時、40/日；失效回報 10/時、30/日。

對正常個人使用者非常寬鬆、對單帳號濫用足夠攔阻；數值集中在 `RATE_LIMITS` 一處，上線後有真實數據再調。

### 4.3 IP throttle（公開列表 API）→ **數值維持，但上線後要實測驗證 XFF 假設**

現值：`GET /api/items` 與 `GET /api/deal-infos` 各每 IP 每分鐘 60 次（`src/lib/ip-throttle.ts:22-31`），行程內記憶體計數、XFF 取**最右一跳**＋SHA-256 雜湊（同檔 54-71）。

程式碼假設「單層 Zeabur 代理、XFF 最右一跳是代理親見的真實 IP」，註解自承**未在正式站驗證**（同檔 40-53）。若 Zeabur 前面還有 edge 層，所有人會共用少數節流 bucket 互相誤傷；若 Zeabur 不覆寫 XFF，攻擊者可偽造繞過。

- [ ] 上線後用兩個不同網路（手機 4G＋家用寬頻）各連打 `GET /api/items` 超過 60 次/分鐘，確認**各自獨立**被 429。若行為不符，需把 `getClientIp` 改成配合實際代理層數取值。

---

## 5. 上線日檢查清單

### 5.1 migration＋seed

- `npm start` 已內建 `prisma migrate deploy && next start`（`package.json:8`）——部署即自動跑 migration。
- seed（`npm run db:seed`，`package.json:11`）**不會**自動執行，需手動跑一次；已確認**完全冪等**：縣市/分類 `upsert` by slug（`prisma/seed.ts:152-166`）、retention 政策 `upsert` 且 `update:{}` 不覆蓋後台調整（seed.ts:174-185）、關鍵字黑名單 `upsert` by unique keyword（seed.ts:189-195）＋一次性清理舊詞條 `deleteMany` 重跑 no-op（seed.ts:200-206）、好康來源 `findFirst` by officialUrl 找不到才 create（seed.ts:212-233）。

- [ ] 部署最新版（migration 隨 start 自動套用）；或先手動 `npx prisma migrate deploy` 確認無 pending。
- [ ] 在正式站環境執行 `npm run db:seed`，stdout 出現「Seed 完成：22 縣市、…分類、…」且數字合理。

### 5.2 `/api/health` 三子系統綠燈

回應格式（`src/app/api/health/route.ts:12-25`）：`{ok, subsystems: {database, storage, background_jobs}}`，全部 up 回 200、否則 503；公開端點刻意只回 status/latencyMs。

```bash
curl -s https://sharegood.nomoneydaddy.app/api/health | \
  jq '{ok, db: .subsystems.database.status, storage: .subsystems.storage.status, jobs: .subsystems.background_jobs.status}'
```

- [ ] HTTP 200 且三個 status 皆 `"up"`（有問題到 `/admin/ops` 看完整 detail）。

### 5.3 備份第一次真實執行（對照 `docs/runbooks/backup-restore.md`）

之前只在本機一次性測試資料庫演練過（`docs/runbooks/backup-drill-log.md`），**正式站 Zeabur PostgreSQL＋MinIO 尚未真的備份過**，MinIO 的 `mc mirror` 一次都沒實跑。

```bash
# PostgreSQL（backup-restore.md:20-22）
pg_dump "$DATABASE_URL" -F c -f sharegood_$(date +%Y%m%d).dump
# MinIO（backup-restore.md:80-95）
mc alias set sharegood-minio "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc mirror sharegood-minio/sharegood ./minio-backup-$(date +%Y%m%d)/
```

- [ ] `.dump` 產生並**下載到 Zeabur 以外**的地方（異地副本是 runbook 明文底線）。
- [ ] `mc mirror` 完成、本地物件數與 bucket 相符。
- [ ] （建議）另開乾淨資料庫 `pg_restore` 一次＋`npx prisma migrate status` 全 Applied＋關鍵表 COUNT 比對。
- [ ] 回填 `docs/runbooks/backup-drill-log.md` 一列（類型：正式站上線首次）。

### 5.4 Google Search Console 提交 sitemap

sitemap 由 `src/app/sitemap.ts` 動態產生（首頁/guide/rules/deal-infos/terms/privacy＋published 物品＋published 好康），`src/app/robots.ts:14` 已宣告 Sitemap 欄位，網域來自 `src/lib/site.ts:5`。

- [ ] GSC 新增資源 `https://sharegood.nomoneydaddy.app`（網址前置字元），用 HTML 標籤／DNS TXT／public/ 檔案任一方式驗證。
- [ ] 「Sitemap」提交 `sitemap.xml`，1-2 天後回來確認狀態「已成功」、已探索網頁數合理。
- [ ] `https://sharegood.nomoneydaddy.app/robots.txt` 內容正確（disallow `/api/`、`/me/`、`/admin/` 等）。

### 5.5 OG 卡片驗證

物品詳情頁 OG：title＝`{物品名}｜{縣市}`、description＝描述前 120 字、image＝第一張圖 medium 變體（`src/app/(shell)/items/[id]/page.tsx:55-80`）。**要挑 `published` 狀態的物品**（`removed_by_moderator`/`pending_review` 刻意回空 metadata）。

- [ ] Facebook Sharing Debugger（https://developers.facebook.com/tools/debug/ ）貼物品連結 → Scrape Again → title/description/image 正確。
- [ ] LINE 聊天室實貼連結看預覽卡片；Threads 貼文編輯器同樣實測（走 Meta 同一套爬蟲）。

### 5.6 法務文案（上線前最後把關）

- [ ] M9 研究列出的 8 項法務文案（`docs/research/2026-07-06-deal-aggregation/04`；站內全部掛 LegalDraftNotice 的頁面）與 M7 的法律相關文案，**上線前需律師／法務審閱**——這是 CLAUDE.md 與 master-plan 明文標註的前置條件，請確認已完成或已知風險自負。

---

## 6. 已知未接線／上線後再補清單

以下皆為盤點時已知、**上線可接受**的遺留項，讓營運心裡有數（來源：CLAUDE.md 各里程碑「已知遺留」＋本次盤點）：

| 項目 | 影響 | 何時補 |
|---|---|---|
| `REQUIRE_REVIEW` 開啟後沒有審核佇列 UI | 目前建議關閉，無影響；要開之前必須先補 UI | 需要先審後上時 |
| IP throttle 的 XFF 單層代理假設未驗證（`src/lib/ip-throttle.ts:40-53`） | 極端情況節流失準 | 上線後第一週實測（§4.3） |
| 通知合併 `findFirst`+`update` 非原子（`src/lib/notify.ts` 相關，CLAUDE.md M4 註記） | 極端併發多一筆通知，無害 | 流量成長後 |
| `retention-purge` 的 `messages_after_completion` 歸檔不去重（`src/lib/retention.ts:403-406`） | 重複執行多寫稽核列，不壞資料 | 有空時 |
| Web Push 金鑰缺漏／推播失敗時前端無明確錯誤（`src/lib/web-push.ts:62-66`） | 除錯要看後端 `NotificationDelivery` | 有使用者回報時 |
| M9 選配：DealInfo stale 逾期自動轉 expired、到期前提醒投稿者 | 靠 TTL job 硬性到期兜底 | M9 後續 |
| give-to-get 級距數字（0分/1次、10分/3次、50分/10次）為工程草案 | 待真實數據調整（`src/lib/give-to-get-quota.ts`） | 上線後看數據 |
| M10 遺留樣式債：`legal-draft-notice.tsx` 暗色對比、多選 chip 觸控目標約 32px、`layout.tsx` 未使用的 next/font 載入 | 視覺小瑕疵 | 前端下一輪 |
| MinIO 正式站季度備份演練從未真跑 | §5.3 上線日補上第一次 | 上線日 |
| GitHub Actions 排程「盡力而為」可能延遲數分鐘 | 分鐘級 job 有抖動，業務可接受 | 無需處理 |

---

## 附錄：上線日最短路徑（TL;DR）

1. §1.2 必填環境變數 4＋Telegram 3＋VAPID 3＋核對 §1.1 → 重新部署。
2. `npm run db:seed`（冪等，放心跑）。
3. §3.1 `setWebhook`、§3.2 OAuth 核對、§3.3 圖片外網 curl、§3.4 推播實測。
4. §2.2 掛 15 支 cron＋手動各打一輪 200。
5. §5.2 health 三綠 → §5.3 首次備份 → §5.4 GSC → §5.5 OG。
6. `ADMIN_EMAIL` 帳號登入進 `/admin` 繞一圈（reports/appeals/ops 四分頁都開得起來）。
