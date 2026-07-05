# ShareGood 好物共享｜Zeabur 一站式最終完整規劃書

版本：Final Integrated Master Plan  
用途：交給 Claude Code / Cursor / Codex 直接執行  
專案名稱：好物共享 ShareGood  
Repo：`sharegood`  
部署目標：Zeabur 一站式部署  
產品定位：全台／縣市級免費共享平台，不做社區圈、不做金流、不做物流、不做交換

---

## 0. 最終判斷

ShareGood 不應該做成「二手交易平台」，也不應該做成「剩食平台」。  
最終定位應該是：

> 把用不到但還能用的好物分享出去，讓剛好需要的人接手。

平台核心是：

1. 免費共享
2. 縣市級搜尋
3. 留言需要
4. 直贈
5. 抽籤
6. 私訊交接
7. 貢獻與守信
8. 檢舉、申訴、使用者回報
9. 關鍵字／類別訂閱通知
10. 資料管理、省流、效能、隱私、資安與後台營運

最終版本可以很完整，但開發順序必須保守。  
先把狀態機、權限、資料存放、省容量、審核治理做好，再做通知與遊戲化。

---

## 1. 外部參考結論

### 1.1 CouponShare 可借的設計

CouponShare 的核心可借：

- 上架用不到的券
- 需要的人留言申請
- 分享者可自己挑人
- 可設定第一位申請者優先
- 貢獻值與每日申請額度
- 即將到期優先推前
- 票券錢包
- 追蹤品牌或分類，有新券通知
- 券碼安全揭露

ShareGood 採用：

- 留言需要
- 分享者挑人
- 先到先得
- 貢獻值解鎖額度
- 即將到期優先
- 優惠券錢包
- 關鍵字／類別訂閱通知

ShareGood 不採用：

- 交換功能
- 私下交易
- 補差價
- 類電商交易流程

原因：ShareGood 的定位是免費共享，不是交換或交易。

---

### 1.2 Freecycle 可借的設計

Freecycle 的核心精神是：

- 免費
- 讓物品不要進垃圾場
- 發文 offer / wanted
- 由雙方私下安排 pickup
- 不得收錢
- 注意 delivery scam

ShareGood 採用：

- 嚴格禁止付款
- 嚴格禁止運費補貼、押金、變相收費
- 分享者可選接手者
- 交接提醒
- 防詐騙提醒
- 私訊只在交接成立後開啟
- 平台不介入物流

ShareGood 不採用：

- Town group / Friends Circle
- 社區圈

原因：你已決定最多做到縣市，不做社區功能。

---

### 1.3 Buy Nothing 可借的設計

Buy Nothing 的核心可借：

- gift economy
- 不急著先搶先贏
- 讓物品「停留一段時間」再選接手者
- 感謝與關係感
- 多種選人方式

ShareGood 採用：

- 留言需要，不只秒搶
- 抽籤
- 分享者挑選
- 感謝牆
- 守信與貢獻值
- 近期領取太多者降權
- 新手保護

ShareGood 不採用：

- 鄰里社群
- 服務交換
- 借用功能

原因：ShareGood 要降低學習成本與營運風險。

---

### 1.4 大型 Zeabur 專案可借的架構

大型 Zeabur 模板常見組合：

- Web / API
- PostgreSQL
- Redis
- MinIO / S3-compatible storage
- Worker
- Queue
- Health checks
- Backups

ShareGood 最終採用：

- Next.js Web monolith
- PostgreSQL
- MinIO
- PostgreSQL job table 起步
- Redis later
- Worker later
- Health dashboard
- backup / restore runbook
- storage cleanup job

MVP 不一開始拆微服務，避免成本與複雜度暴增。

---

## 2. 最終技術棧

### 2.1 Zeabur 一站式部署版

預設採用 Zeabur 內服務完成一站式部署。

| 層級 | 技術 | Zeabur Service |
|---|---|---|
| Web / 前台 / 後台 / API | Next.js App Router | `sharegood-web` |
| DB | PostgreSQL | `sharegood-postgres` |
| Object Storage | MinIO | `sharegood-minio` |
| Background Jobs | Next.js internal cron / job route 起步 | `sharegood-web` |
| Worker | Node.js worker later | `sharegood-worker` |
| Cache / Queue / Rate limit | Redis later | `sharegood-redis` |
| Auth | Auth.js + Google / LINE OAuth | app 內 |
| ORM | Prisma | app 內 |
| UI | Tailwind CSS + shadcn/ui | app 內 |
| Notification | In-app + Telegram + Web Push | app 內 |
| Deployment | GitHub → Zeabur CI/CD | Zeabur |
| Logs | Zeabur logs + app error tables | Zeabur + DB |

---

### 2.2 免費空間限制下的建議

Zeabur Free Plan 適合探索、學習、demo 與小型測試。  
若要正式營運，要預期 Free Plan 的限制：

- 服務 idle 後 auto-sleep，首次請求可能冷啟動
- 沒有 SLA
- 沒有 Zeabur Email
- 進階 DB backup/import 與 log forwarding 不在 Free Plan
- log retention 較短
- 單檔上傳限制較小
- 若流量與圖片增加，Storage 會成為第一個瓶頸

因此最終規劃採雙模式：

| 模式 | 用途 | 部署 |
|---|---|---|
| Demo Mode | 內測、展示、Claude 開發 | Zeabur Free 可用 |
| Production Lite | 小流量正式上線 | Zeabur Dev 起跳 |
| Production | 穩定營運 | Zeabur Pro / HA / Redis / Worker |
| Scale Mode | 大量圖片、通知、私訊 | 外部 CDN 或擴充 storage，可保留 Zeabur 主站 |

你說「最好 Zeabur 一站式」，所以主規劃用 Zeabur 一站式。  
但要在文件中保留「Storage 外移」作為未來 escape hatch，避免圖片爆量時被綁死。

---

## 3. Zeabur 服務設計

### 3.1 MVP 服務

```text
sharegood-web
sharegood-postgres
sharegood-minio
```

### 3.2 正式版服務

```text
sharegood-web
sharegood-postgres
sharegood-minio
sharegood-worker
sharegood-redis
```

### 3.3 大流量版服務

```text
sharegood-web
sharegood-api
sharegood-worker
sharegood-realtime
sharegood-postgres
sharegood-postgres-read
sharegood-redis
sharegood-minio
sharegood-observability
```

### 3.4 各服務職責

| Service | 職責 |
|---|---|
| `sharegood-web` | 前台、後台、API、Auth、基本通知 |
| `sharegood-postgres` | 主要結構化資料 |
| `sharegood-minio` | 圖片、附件、匯出包 |
| `sharegood-worker` | 到期下架、通知、抽籤、摘要、清理 |
| `sharegood-redis` | rate limit、cache、queue、session lock |
| `sharegood-realtime` | SSE / WebSocket 私訊與即時通知 |

---

## 4. 資料存放與容量策略

### 4.1 PostgreSQL 只放文字、狀態、metadata

DB 放：

- users
- profiles
- items metadata
- categories
- cities
- claim comments
- direct shares
- lottery records
- messages text
- reports metadata
- appeals metadata
- notifications
- contribution events
- badges
- audit logs
- sensitive access logs
- storage object keys

DB 不放：

- 圖片 binary
- 原始大圖
- 匯出 ZIP binary
- 備份檔
- 大型附件 binary
- Telegram raw payload 長期保存
- Web Push endpoint 原始 log

---

### 4.2 MinIO 放檔案

MinIO 放：

- 物品圖片
- 物品縮圖
- 檢舉附件
- 申訴附件
- 使用者回報截圖
- 資料匯出包
- 法務匯出包
- 系統產生的公開 OG 圖，若未來需要

---

### 4.3 圖片省容量策略

上傳流程：

```text
使用者上傳圖片
→ 驗證 magic bytes
→ 檢查大小
→ 移除 EXIF
→ 壓縮
→ 產生 thumb / medium
→ 可選保留 large
→ 原圖預設不保留
→ 上傳 MinIO
→ DB 只存 object key
```

建議限制：

| 項目 | 限制 |
|---|---|
| 單張原始上傳 | 5 MB |
| 壓縮後 medium | 300～500 KB |
| thumb | 50～120 KB |
| 每物品圖片 | 最多 5 張 |
| 檢舉附件 | 最多 3 張 |
| 申訴附件 | 最多 3 張 |
| 使用者回報附件 | 最多 3 張 |
| 格式 | jpg / png / webp |
| 不支援 | video / gif / svg / heic MVP 不做 |

圖片尺寸：

| 尺寸 | 用途 |
|---|---|
| thumb 320px | 列表 |
| medium 768px | 詳情 |
| large 1280px | 放大 |
| original | 預設不保留 |

---

### 4.4 Storage 清理策略

每天執行：

- 清理未關聯上傳檔
- 清理失敗上傳暫存
- 清理過期匯出包
- 清理已停用 Web Push endpoint
- 清理過期 Telegram link token
- 清理已封存物品的多餘 large 圖
- 清理結案超過保留期的附件，除非 legal hold

不可清理：

- legal hold 目標資料
- active report / appeal evidence
- sensitive access logs
- audit logs
- coupon reveal logs

---

### 4.5 資料保留期限

| 資料 | 保留策略 |
|---|---|
| 公開物品 metadata | 長期保留或封存 |
| 已完成物品圖片 | 180 天後可只留 thumb，視政策 |
| 過期優惠券圖片 | 90～180 天後清理 |
| 即期好物圖片 | 90 天後清理，metadata 留存 |
| 私訊 | 完成共享後 90 天可封存，爭議或 legal hold 不刪 |
| 通知 | 90 天後可清理 |
| Telegram raw update | 7～30 天 |
| Web Push endpoint | 失效即刪 |
| 檢舉 / 申訴證據 | 結案後 180～365 天，legal hold 例外 |
| audit log | 長期 |
| sensitive access log | 長期 |
| 資料匯出包 | 7 天自動刪 |
| 法務匯出包 | 依案件，過期自動刪，交付紀錄保留 |

---

## 5. 最終功能範圍

### 5.1 使用者端功能

1. OAuth 登入
2. 設定暱稱與縣市
3. 我要分享
4. 圖片上傳
5. 好物列表
6. 好物詳情
7. 留言需要
8. 先到先得
9. 直贈
10. 抽籤
11. 私訊交接
12. 完成共享
13. 感謝留言
14. 共享值
15. 徽章
16. 排行榜
17. 優惠券錢包
18. 券碼安全揭露
19. 即將到期提醒
20. 關鍵字訂閱
21. 類別訂閱
22. 縣市訂閱
23. 站內通知
24. Telegram 通知
25. Web Push
26. 回報問題
27. 回報違規
28. 申訴
29. 隱私設定
30. 資料匯出 / 刪除請求

---

### 5.2 管理端功能

1. 後台 Dashboard
2. 物品審核
3. 強制下架
4. 自動下架紀錄
5. 使用者管理
6. 功能限制
7. 黑名單
8. 檢舉管理
9. 申訴管理
10. 使用者回報管理
11. 抽籤管理
12. 私訊案件調閱
13. 通知管理
14. Telegram webhook 狀態
15. Web Push delivery 狀態
16. 訂閱通知管理
17. 關鍵字黑名單
18. 共享值與徽章管理
19. 排行榜重算
20. 敏感資料調閱紀錄
21. audit log
22. backup dashboard
23. storage usage dashboard
24. performance dashboard
25. system health
26. legal request / legal hold
27. data retention / purge jobs
28. feature flags
29. terms / privacy versioning

---

## 6. MVP 缺口與最終補齊

### 6.1 若只做一般 MVP，會缺的東西

| 缺口 | 風險 | 最終處理 |
|---|---|---|
| 使用者回報 | 使用者遇到 bug 沒入口 | 加入 MVP |
| 強制下架 | 違規物品無法處理 | 加入 MVP |
| 功能限制 | 惡意使用者無法管控 | 加入 MVP |
| audit log | 管理操作不可追 | 加入 MVP |
| 權限中介層 | API 越權 | 加入 MVP |
| 圖片壓縮 | 免費空間爆掉 | 加入 MVP |
| Storage 清理 | 檔案持續累積 | 加入 MVP |
| rate limit | 被洗留言、檢舉、私訊 | 加入 MVP |
| 過期自動下架 | 優惠券與食品過期仍可見 | 加入 MVP |
| 隱私設定 | 通知與資料權利不足 | 加入 MVP |
| 訂閱通知 | 使用者回訪不足 | V1.1 |
| 法務請求 | 遇案件無流程 | V1.1 / 正式上線前 |
| 後台健康 | 不知道系統壞在哪 | V1.0 |
| 備份還原 | DB 出事無法救 | V1.0 |
| 效能索引 | 多人在線變慢 | V1.0 |
| 省流 | 圖片流量成本爆 | V1.0 |

---

### 6.2 同類平台常見問題對應

| 問題 | ShareGood 對策 |
|---|---|
| 有人只領不分享 | 共享值、每日額度、熱門物品降權 |
| 有人轉賣 | 禁止私下收費、檢舉、功能限制、黑名單 |
| 秒搶不公平 | 留言需要、抽籤、近期少領加權 |
| 分享者不想被催 | 私訊只在接受後開啟 |
| 交接失約 | 守信紀錄、冷卻期、扣分 |
| 過期券仍上架 | 到期欄位、提醒、自動下架 |
| 券碼被偷看 | 加密保存、接受後揭露、reveal log |
| 食品風險 | 僅完整包裝、未開封、常溫、未過期 |
| 通知太吵 | 預設每日摘要、通知上限、可關閉 |
| 圖片吃空間 | 壓縮、縮圖、清理、原圖不保留 |
| 管理員濫權 | RBAC、audit log、sensitive access log |
| 警方調閱無流程 | legal request + legal hold + 最小揭露 |

---

## 7. 頁面地圖

### 7.1 前台頁面

| 頁面 | 路徑 | 說明 |
|---|---|---|
| 首頁 | `/` | 搜尋、分類、縣市、主 CTA |
| 好物列表 | `/items` | 分類、縣市、關鍵字、狀態 |
| 好物詳情 | `/items/[id]` | 留言需要、抽籤、直贈狀態 |
| 我要分享 | `/items/new` | 分步上架 |
| 編輯分享 | `/items/[id]/edit` | 草稿或退回修改 |
| 我的分享 | `/me/items` | 草稿、審核中、公開、過期、完成 |
| 我的需要 | `/me/claims` | 留言、抽籤、直贈、交接 |
| 優惠券錢包 | `/me/wallet` | 分享出去、接手到的券 |
| 私訊 | `/messages` | 交接成立後 |
| 通知中心 | `/notifications` | 所有通知 |
| 我的訂閱 | `/me/subscriptions` | 關鍵字、類別、縣市訂閱 |
| 個人頁 | `/u/[id]` | 暱稱、縣市、徽章、共享值 |
| 徽章牆 | `/me/badges` | 徽章與進度 |
| 排行榜 | `/leaderboard` | 全台、縣市、分類 |
| 感謝牆 | `/thanks` | 感謝內容 |
| 回報問題 | `/support/report` | bug、帳號、操作問題 |
| 回報違規 | `/reports/new` | 詐騙、私下收費、食品疑慮 |
| 申訴 | `/appeals/new` | 下架、限制、扣分 |
| 隱私設定 | `/me/privacy` | 隱私與資料設定 |
| 資料管理 | `/me/data` | 匯出、更正、刪除 |
| 通知設定 | `/me/notifications` | 站內、TG、Web Push |
| 登入裝置 | `/me/sessions` | session 管理 |
| 新手說明 | `/guide` | 3 分鐘上手 |
| 使用規範 | `/rules` | 禁止品項 |
| 隱私權政策 | `/privacy` | 個資與資料使用 |
| 服務條款 | `/terms` | 平台規則 |

---

### 7.2 後台頁面

| 頁面 | 路徑 | 說明 |
|---|---|---|
| 後台總覽 | `/admin` | 待辦、SLA、風險、健康 |
| 物品審核 | `/admin/items` | 通過、退回、下架 |
| 強制下架 | `/admin/removals` | 下架紀錄 |
| 使用者 | `/admin/users` | 權限、限制、停權 |
| 功能限制 | `/admin/restrictions` | 黑名單 |
| 檢舉 | `/admin/reports` | 違規案件 |
| 申訴 | `/admin/appeals` | 複審 |
| 使用者回報 | `/admin/support` | bug、帳號問題 |
| 抽籤 | `/admin/lotteries` | 監控、遞補、重抽 |
| 私訊調閱 | `/admin/messages` | 案件關聯 |
| 訂閱通知 | `/admin/subscriptions` | 訂閱、關鍵字、發送量 |
| 通知 | `/admin/notifications` | delivery logs |
| Telegram | `/admin/telegram` | webhook 狀態 |
| Web Push | `/admin/web-push` | delivery / endpoint |
| 優惠券 | `/admin/coupons` | reveal logs |
| 徽章 | `/admin/badges` | 定義、授予 |
| 排行榜 | `/admin/leaderboards` | snapshot、重算 |
| 資料管理 | `/admin/data` | retention、purge |
| Storage | `/admin/storage` | 容量、清理、孤兒檔 |
| 效能 | `/admin/performance` | 慢查詢、流量 |
| 系統健康 | `/admin/health` | DB、MinIO、worker |
| 備份 | `/admin/backups` | 備份、還原演練 |
| 法務請求 | `/admin/legal-requests` | 機關請求 |
| Legal Hold | `/admin/legal-holds` | 資料保全 |
| 稽核 | `/admin/audit-logs` | 管理操作 |
| 敏感調閱 | `/admin/sensitive-logs` | 私訊、券碼、證據 |
| 條款版本 | `/admin/policies` | terms/privacy version |
| Feature Flags | `/admin/flags` | 功能開關 |

---

## 8. 資料庫總表

### 8.1 使用者與權限

```text
users
accounts
sessions
profiles
user_roles
user_sessions
privacy_consents
```

### 8.2 物品與圖片

```text
items
item_images
item_status_logs
item_removals
item_expiration_logs
item_categories
```

### 8.3 優惠券

```text
coupon_details
coupon_secrets
coupon_reveal_logs
coupon_usage_reports
```

### 8.4 索取與共享

```text
claim_comments
direct_shares
handover_records
handover_confirmations
thanks_messages
```

### 8.5 抽籤

```text
lotteries
lottery_entries
lottery_results
lottery_audit_logs
```

### 8.6 私訊

```text
conversations
conversation_members
messages
message_read_receipts
message_reports
```

### 8.7 檢舉、申訴、回報

```text
reports
report_evidence
appeals
appeal_evidence
support_tickets
support_ticket_events
support_ticket_attachments
support_ticket_assignments
```

### 8.8 治理

```text
moderation_cases
moderation_actions
user_restrictions
user_blocks
risk_flags
audit_logs
sensitive_access_logs
```

### 8.9 貢獻與遊戲化

```text
contribution_events
badges
user_badges
leaderboard_snapshots
leaderboard_exclusions
```

### 8.10 通知

```text
domain_events
notifications
notification_preferences
notification_deliveries
notification_jobs
web_push_subscriptions
telegram_accounts
telegram_link_tokens
telegram_updates
```

### 8.11 訂閱通知

```text
user_subscriptions
subscription_keywords
subscription_categories
subscription_cities
subscription_matches
subscription_digest_jobs
subscription_delivery_logs
```

### 8.12 資料管理

```text
privacy_requests
privacy_request_events
data_exports
data_deletion_jobs
data_retention_policies
data_archive_jobs
data_purge_logs
storage_objects
storage_cleanup_jobs
```

### 8.13 法務與警方配合

```text
law_enforcement_requests
law_enforcement_request_documents
law_enforcement_request_targets
law_enforcement_request_events
law_enforcement_exports
law_enforcement_export_files
law_enforcement_deliveries
law_enforcement_user_notifications
legal_holds
legal_hold_targets
legal_hold_events
```

### 8.14 系統與效能

```text
system_jobs
system_job_runs
health_checks
error_logs
performance_metrics
api_rate_limit_logs
storage_usage_snapshots
bandwidth_usage_snapshots
cache_invalidation_logs
```

---

## 9. 主要狀態機

### 9.1 物品狀態

```text
draft
pending_review
published
reserved
lottery_open
lottery_closed
lottery_drawn
handover_pending
completed
expired
rejected
removed_by_user
removed_by_moderator
force_removed
disputed
archived
```

### 9.2 留言需要狀態

```text
commented
accepted
declined
cancelled
expired
completed
no_show
disputed
```

### 9.3 直贈狀態

```text
invited
accepted
declined
expired
cancelled
completed
disputed
```

### 9.4 抽籤狀態

```text
open
closed
drawn
winner_pending
winner_confirmed
backup_pending
completed
cancelled
disputed
```

### 9.5 回報與申訴狀態

```text
submitted
triaged
in_progress
need_more_info
resolved
rejected
closed
reopened
```

---

## 10. 效能、索引與省流

### 10.1 必備索引

```text
items(status, city, category_id, created_at)
items(status, expires_at)
items(owner_id, status, created_at)
claim_comments(item_id, status, created_at)
claim_comments(user_id, status, created_at)
direct_shares(receiver_id, status, created_at)
lotteries(item_id, status, entry_deadline)
lottery_entries(lottery_id, user_id)
notifications(user_id, read_at, created_at)
messages(conversation_id, created_at)
reports(status, priority, created_at)
appeals(status, created_at)
support_tickets(status, priority, created_at)
contribution_events(user_id, created_at)
subscription_matches(user_id, subscription_id, item_id)
subscription_keywords(normalized_keyword)
audit_logs(actor_id, created_at)
sensitive_access_logs(actor_id, created_at)
```

### 10.2 查詢規則

- 所有列表必須分頁
- 禁止 `SELECT *`
- 前台列表只回必要欄位
- 後台列表必須篩選與分頁
- 私訊預設只取最新 30 則
- 通知預設只取最新 20 則
- 排行榜使用 snapshot
- 統計使用 daily aggregation
- 到期下架用 job
- 大型任務不可在 request 內同步完成

### 10.3 快取

| 資料 | 策略 |
|---|---|
| 分類 | long cache |
| 縣市 | long cache |
| 首頁熱門 | short cache |
| 排行榜 | snapshot cache |
| 徽章定義 | cache |
| 使用規範 | version cache |
| 私訊 | no shared cache |
| 券碼 | no cache |
| 檢舉申訴 | no cache |
| 法務資料 | no cache |

---

## 11. 多人在線與擴展

### 11.1 MVP 多人在線策略

MVP 使用：

- PostgreSQL transaction
- unique constraint
- rate limit
- cursor pagination
- image compression
- polling for private messages
- background jobs for notifications

不使用：

- heavy websocket
- full-text search service
- microservice
- external queue
- video upload

### 11.2 併發保護

| 場景 | 保護 |
|---|---|
| 先到先得 | transaction + row lock |
| 重複留言 | unique(item_id, user_id) |
| 抽籤重複報名 | unique(lottery_id, user_id) |
| 抽籤重複執行 | job lock |
| 直贈重複接受 | transaction |
| 完成共享重複確認 | idempotency key |
| Telegram webhook 重複 | update_id 去重 |
| 通知重複 | delivery idempotency |

---

## 12. 資安與隱私

### 12.1 不收資料

V1 不收：

- 真名
- 電話
- 地址
- GPS
- 身分證
- 生日
- 家庭狀況
- 收入
- 詳細交接地點

### 12.2 必防風險

| 風險 | 對策 |
|---|---|
| IDOR | object-level permission |
| Broken Access Control | server-side permission |
| XSS | escape + sanitize |
| CSRF | protected mutation |
| Upload Attack | magic bytes + size + extension |
| Webhook Forgery | Telegram secret header |
| Coupon Leak | encryption + reveal log |
| Admin Abuse | audit + sensitive access |
| Notification Leak | no sensitive content |
| Rate Abuse | rate limit |

---

## 13. 關鍵字與類別訂閱通知

### 13.1 功能

使用者可訂閱：

- 關鍵字
- 類別
- 縣市
- 組合條件

範例：

```text
台北市 + 咖啡 + 優惠券
台中市 + 童書 + 玩具童書
全台 + 貓砂 + 寵物用品
```

### 13.2 預設頻率

| 頻率 | 預設 |
|---|---|
| 即時 | 關 |
| 每日摘要 | 開 |
| 每週摘要 | 可選 |
| 只儲存搜尋 | 可選 |

### 13.3 防洗版

- 每人最多 20 個訂閱
- 每個訂閱最多 5 個關鍵字
- 同物品同訂閱只通知一次
- 每人每日訂閱通知上限
- 30 分鐘合併通知
- Telegram / Web Push 不放完整清單

---

## 14. 強制下架與過期下架

### 14.1 自動下架

| 類型 | 條件 | 動作 |
|---|---|---|
| 優惠券 | 到期 | expired |
| 即期好物 | 到期 | expired |
| 直贈 | 逾時 | expired |
| 抽籤報名 | 截止 | closed |
| 抽籤中選 | 逾時未確認 | 遞補 |
| 草稿 | 30 天未更新 | archived |

正常過期不扣分。  
明知過期仍上架、食品期限造假、券碼已使用仍上架才扣分。

### 14.2 強制下架

原因：

- 違禁物品
- 食品疑慮
- 過期食品
- 私下收費
- 描述不實
- 詐騙風險
- 個資外洩
- 騷擾
- 法務請求

強制下架需：

- 原因
- 備註
- audit log
- 通知使用者
- 可申訴
- 若敏感案件，限制通知內容

---

## 15. 後台完整度

正式營運後台必須做到：

- Dashboard
- SLA
- 案件指派
- 高風險提醒
- 批次操作
- 二次確認
- audit log
- sensitive access log
- 系統健康
- 備份狀態
- Storage 用量
- 通知失敗重送
- Worker job 狀態
- 權限矩陣
- legal request
- retention / purge

---

## 16. Git 流程

### 16.1 分支

```text
main
develop
feature/*
fix/*
hotfix/*
release/*
```

### 16.2 Commit

```text
feat:
fix:
perf:
sec:
docs:
test:
chore:
```

### 16.3 發版

```text
v0.1.0 foundation
v0.2.0 sharing
v0.3.0 need/direct/handover
v0.4.0 moderation
v0.5.0 contribution
v0.6.0 coupon/expiration
v0.7.0 privacy/data/support
v0.8.0 notification
v0.9.0 lottery/message/restriction
v1.0.0 production-lite
v1.1.0 subscription/performance/storage
v1.2.0 admin/ops/legal
v2.0.0 scale
```

---

## 17. Claude Code 執行順序

### Phase 1：Foundation

1. Next.js
2. TypeScript strict
3. Tailwind + shadcn
4. Prisma + PostgreSQL
5. Auth.js
6. roles
7. permissions
8. audit logs
9. seed categories / cities
10. admin seed

### Phase 2：Storage First

1. MinIO integration
2. image validation
3. image compression
4. thumbnail generation
5. storage object table
6. cleanup job
7. upload rate limit

### Phase 3：Core Sharing

1. items schema
2. item form
3. item list
4. item detail
5. review workflow
6. my items
7. auto expiration fields

### Phase 4：Need / Direct / Complete

1. claim comments
2. accept / decline
3. direct shares
4. handover
5. contribution events
6. notifications

### Phase 5：Governance

1. force removal
2. reports
3. appeals
4. support tickets
5. user restrictions
6. admin dashboard
7. sensitive logs

### Phase 6：Coupon / Wallet / Expiration

1. coupon details
2. encrypted secrets
3. reveal logs
4. wallet
5. expiration jobs
6. reminders

### Phase 7：Notifications

1. domain events
2. in-app notifications
3. preferences
4. Telegram Bot
5. Web Push
6. notification delivery logs

### Phase 8：Subscriptions

1. user_subscriptions
2. keywords
3. categories
4. cities
5. subscription match job
6. digest notification
7. admin subscription dashboard

### Phase 9：Lottery / Messaging

1. lottery
2. draw
3. backup winner
4. conversation
5. messages
6. message reports
7. auto lock

### Phase 10：Data / Privacy / Legal

1. privacy requests
2. data export
3. account deletion
4. retention policies
5. legal requests
6. legal holds
7. legal exports

### Phase 11：Ops / Performance

1. indexes
2. pagination
3. rate limit
4. cache
5. health checks
6. backup status
7. storage dashboard
8. performance metrics
9. E2E tests
10. Zeabur deployment

---

## 18. 最終驗收標準

### 18.1 產品驗收

- 使用者 10 秒內理解平台
- 1 分鐘內完成註冊
- 2 分鐘內完成分享
- 可以留言需要
- 可以直贈
- 可以抽籤
- 可以完成共享
- 可以收到通知
- 可以訂閱關鍵字
- 可以回報問題
- 可以回報違規
- 可以申訴

### 18.2 資料與省流驗收

- 圖片不進 DB
- 原圖預設不保留
- 圖片有 thumb / medium
- 所有列表分頁
- 私訊分頁
- 通知分頁
- Storage 有清理 job
- 過期匯出包自動刪
- MinIO 容量可在後台查看
- DB 慢查詢可記錄

### 18.3 後台驗收

- 可審核物品
- 可強制下架
- 可限制功能
- 可處理檢舉
- 可處理申訴
- 可處理回報
- 可看系統健康
- 可看備份狀態
- 可看 storage usage
- 所有管理操作有 audit
- 所有敏感調閱有 sensitive log

### 18.4 Zeabur 驗收

- GitHub push 可部署
- Postgres 正常
- MinIO 正常
- Web service 正常
- 環境變數正確
- migration 成功
- seed 成功
- admin 可登入
- Telegram webhook 可驗證
- Web Push 可訂閱
- backup runbook 有文件
- restore rehearsal 有紀錄

---

## 19. 最終缺口檢查

### 19.1 原本沒想到但已補入

| 面向 | 是否補入 |
|---|---|
| 使用者回報 | 已補 |
| 資料管理 | 已補 |
| 省流 | 已補 |
| 效能 | 已補 |
| Storage 容量 | 已補 |
| MinIO 一站式 | 已補 |
| 法務／警方配合 | 已補 |
| 關鍵字訂閱 | 已補 |
| 類別訂閱 | 已補 |
| 過期自動下架 | 已補 |
| 後台完整工作台 | 已補 |
| 備份還原 | 已補 |
| 多人在線 | 已補 |
| 黑名單與功能限制 | 已補 |
| 私訊安全 | 已補 |
| 券碼安全 | 已補 |
| 使用者資料權利 | 已補 |
| anti-reseller | 已補 |
| anti-hoarding | 已補 |
| notification fatigue | 已補 |
| auditability | 已補 |

### 19.2 仍建議正式上線前人工確認

1. 台灣律師審使用條款與隱私權政策
2. 食品類規範確認
3. Zeabur 方案容量與費用確認
4. Zeabur backup 功能在目前方案是否可用
5. Telegram Bot 正式帳號設定
6. Google / LINE OAuth 審核
7. 網域與品牌名稱查詢
8. 圖片容量壓力測試
9. 私訊與通知壓力測試
10. 後台權限越權測試

---

## 20. 最終結論

ShareGood 最終架構應採：

```text
Zeabur 一站式部署
Next.js monolith
PostgreSQL
MinIO
Prisma
Auth.js
PostgreSQL job table 起步
Redis / Worker 作為 V1.5+ 擴充
```

免費空間有限時，最重要的不是少做功能，而是：

1. 圖片不進 DB
2. 原圖不保存
3. 所有列表分頁
4. 通知摘要化
5. Storage cleanup
6. retention policy
7. legal hold 例外
8. 後台容量監控
9. 備份與還原演練
10. 上線後依用量升級 Zeabur 方案

Claude Code 應以這份文件作為最終主控規格，按 Phase 實作，不要一次把所有功能塞在第一個 PR。
