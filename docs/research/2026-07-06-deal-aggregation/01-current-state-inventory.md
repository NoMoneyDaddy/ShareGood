# 現況盤點與落差分析（對照「共享好物＋好康聚合」新總控指令）

> 查證方式：唯讀讀碼與 grep，所有「已支援」判斷附 file:line。查證日期：2026-07-06（main @ M0–M8 全部合併後）。

## 1. 五種內容類型支援度

| 項目 | 狀態 | 佐證 | 備註 |
|---|---|---|---|
| 實體物品 | 已支援 | `prisma/schema.prisma:288-333`（Item）、`src/app/items/new/item-form.tsx` | 完整主迴路 |
| 優惠券 | 部分支援 | `prisma/schema.prisma:805-847`（CouponDetail/CouponSecret/CouponRevealLog）、`src/app/api/items/route.ts:52-67,143-152` | **靠分類 slug 判斷**（`route.ts:135`），不是獨立內容類型。欄位僅：faceValue、merchantName、notes、code、expiresAt（共用 Item.expiresAt） |
| 電子票券 | 未支援 | schema 全文無 ticket/voucher 類型；Item 無 type 欄位 | 可勉強塞進優惠券分類，但無轉讓確認等票券語意 |
| 超商/會員點數（序號） | 未支援 | grep `point|序號` 無對應模型 | 無點數/序號類型 |
| 純資訊類好康（無實體交付） | 未支援 | Item 必填 1-5 張圖（`route.ts:12,115-117`）、必走 claims/handover 狀態機 | 現有狀態機假設「一對一交付」，資訊類完全沒有對應路徑 |

即期食品：部分支援——僅「到期日＋四項確認 checkbox」（`item-form.tsx:324-349`、`route.ts:154-161`），確認紀錄借用 `ItemStatusLog.reason` 存自由文字（`route.ts:229-239`），無結構化欄位。

## 2. 搜尋與查找

| 項目 | 狀態 | 佐證 | 備註 |
|---|---|---|---|
| 列表 API（縣市/分類/關鍵字/cursor 分頁） | 已支援 | `src/app/api/items/route.ts:293-372` | 關鍵字為 title/description `contains`（:316-323），無全文檢索 |
| sort=expiring | 已支援 | `route.ts:310,326-333` | 僅 newest / expiring 兩種 |
| **首頁假資料（已知缺口）** | 確認仍在 | `src/app/page.tsx:13-46`（DEMO_ITEMS）、:98-102（搜尋框 disabled）、:138（「示範資料」字樣） | 列表 API 存在但**沒有任何前端頁面呼叫它** |
| 搜尋結果頁/分類頁/地區頁 | 未支援 | `src/app/` 下 items 只有 `[id]` 與 `new`，無 /search、/items 列表路由 | 底部導覽「我的需要」也是 disabled（`bottom-tab.tsx:22`） |
| 品牌/商家/門市維度 | 未支援 | 唯一相關欄位是 `CouponDetail.merchantName` 自由文字（schema:809），非實體、不可篩選 | |
| 距離排序 | 未支援 | schema 無 latitude/longitude/geo 欄位 | 地理粒度只有縣市 |
| 熱門排序、同義詞、錯字容錯、搜尋建議、熱門關鍵字、最近搜尋、相似推薦、去重、來源可信度 | 全部未支援 | grep `synonym|fuzzy|pg_trgm|tsvector|popular|viewCount` 皆無命中 | 「熱門好物」只是首頁假資料區塊標題 |

## 3. 訂閱與通知

| 項目 | 狀態 | 佐證 | 備註 |
|---|---|---|---|
| 站內通知＋合併＋每日上限 | 已支援 | `src/lib/notifications.ts:54,126` | 8 種事件類型見 `src/lib/notification-preferences.ts:7-66` |
| 通知偏好（每事件 站內/外部 開關） | 已支援 | `/me/notification-preferences` | 無管道別（Telegram vs Push）分開設定 |
| 關鍵字/分類/縣市訂閱＋即時/每日摘要 | 已支援 | schema:1117-1212、`/api/jobs/subscription-{match-scan,daily-digest}` | |
| Web Push 初次發送 | 部分支援 | `src/lib/subscription-notify.ts:89-123` | **僅 subscription_match/digest 兩事件會真的派送**；留言/直贈/交接等事件只有站內通知 |
| **Telegram 初次發送管線** | 未支援（缺口仍在） | `CLAUDE.md:205`；grep 確認 `sendTelegramMessage` 呼叫端只有 webhook 綁定回覆（`webhook/route.ts:93-160`）與重試 job（`notification-retry.ts:158`） | 重試 job 只重送「已存在的 failed delivery」，但從沒有東西建立 telegram 的初次 delivery——**綁了 Telegram 也收不到任何業務通知** |
| 品牌/商家/門市訂閱、降價通知、失效回報通知 | 未支援 | 訂閱三維度僅 keyword/category/city（schema:1128-1131）；無價格概念 | |
| LINE Messaging API、Email、RSS、安靜時段、通知頻率個人化 | 全部未支援 | grep 皆零命中 | |

## 4. 發布/申請/領取流程

| 項目 | 狀態 | 佐證 | 備註 |
|---|---|---|---|
| 先到先得 claims | 已支援 | `api/items/[id]/claims`、schema:375-392 | |
| 直贈（email 指定＋72h lazy expiry） | 已支援 | `api/items/[id]/direct-shares[...]`、schema:401-415 | |
| 抽籤（決定性洗牌＋遞補＋稽核） | 已支援 | schema:1026-1109、`src/lib/lottery.ts` | |
| 交接雙確認/no-show | 已支援 | `api/handover/[id]/{complete,no-show}`、schema:423-438 | |
| 券碼加密與揭露 | 已支援 | 加密：`api/items/route.ts:244-262`（AES-256-GCM）；揭露：`api/items/[id]/coupon/reveal/route.ts:44-58`（僅 handover_pending/completed 的 receiver，先解密成功才寫 CouponRevealLog，刻意不去重以留稽核） | 運作方式健全 |
| 使用者回報「可用/失效」 | 未支援 | 無優惠券失效回報機制 | |
| 票券轉讓確認流程 | 未支援 | 無票券類型 | |
| 條碼遮蔽 | 未支援 | grep `mask|barcode|條碼|遮蔽` 零命中 | 券碼本身不上圖、靠加密＋延遲揭露，等效防護已有一半；圖片若含條碼則無遮蔽 |
| 新指令 §17 五類型分流 | 未支援 | 全部類型共用同一 ItemStatus 狀態機（schema:276-286） | |

## 5. 資安/隱私/法務

| 項目 | 狀態 | 佐證 |
|---|---|---|
| 檢舉三對象＋狀態機、強制下架、功能限制/封鎖、申訴、rate limit、關鍵字黑名單 | 已支援 | schema:546-799；`src/lib/{rate-limit,keyword-blocklist,restrictions}.ts` |
| 資料匯出/帳號刪除（冷卻期）/retention/legal hold/司法調閱雙人審核 | 已支援 | schema:1288-1513；`src/lib/{account-deletion,retention,legal-hold}.ts` |
| 稽核/錯誤記錄/健康檢查/慢查詢 | 已支援 | schema:205-220,1517-1572；`src/instrumentation.ts` |
| **圖片 EXIF 移除** | 已支援 | `src/lib/images.ts:4,111`（sharp 預設丟棄 metadata、GPS 一併移除） |
| 管理員 2FA | 未支援 | 僅 Google OAuth（可靠強制 Google 2SV 達等效） |
| 防爬蟲 | 未支援 | rate limit 只管登入使用者的 mutation；`GET /api/items` 匿名可打、無 IP 級限制 |
| 異常行為偵測 | 未支援 | error_logs 記例外，非行為偵測 |
| 條款版本管理 | 未支援 | `/terms` 硬編「最後更新」，無 TermsVersion 表、無使用者同意紀錄 |
| 品牌投訴/內容移除流程 | 部分支援 | 一般檢舉＋強制下架可承接，無品牌方專用通道 |
| 非官方合作聲明文案 | 未支援 | 全站無此類聲明 |
| 法務頁成熟度 | 完整草案（非佔位） | `/terms` 10 節、`/privacy` 9 節、`/rules`/`/guide` 含 FAQPage JSON-LD；皆掛 `LegalDraftNotice` 警語 |

## 6. 後台

現有子頁：`/admin` ＋ reports、appeals、support-tickets、items、users、audit-logs（AdminNav 7 項），另有**不在導覽裡的** ops（4 分頁）、data、legal-holds、legal-requests。

- **M7/M8 子頁為孤兒頁**：grep 全 src 無任何 `href` 指向 `/admin/ops`、`/admin/data`、`/admin/legal-holds`、`/admin/legal-requests`。
- 對照新指令 §23 缺口：來源管理、失效回報管理、系統公告、條款版本管理、黑名單獨立管理頁（KeywordBlocklist 表存在 schema:780-787 但無 CRUD 頁）、熱門搜尋管理、審核佇列 UI（REQUIRE_REVIEW 開啟後物品進 pending_review，但後台審核佇列 UI 不存在——`api/items/route.ts:197-198` 註解明言不在範圍）。

## 7. 視覺/文案

| 項目 | 狀態 | 佐證 |
|---|---|---|
| favicon | 已支援 | `src/app/favicon.ico` |
| OG metadata | 已支援 | `layout.tsx:30`、物品頁 generateMetadata＋JSON-LD |
| OG 靜態圖檔 | 未支援 | 無 opengraph-image 檔案 |
| PWA manifest/icon | 未支援 | 無 manifest；`public/` 只有 llms.txt、sw.js |
| Landing page | 首頁即 landing | hero＋三步驟＋信任條款＋CTA 結構，但核心區塊是假資料 |
| 首頁圖片用外部 placeholder | 問題 | `page.tsx:124,149` 用 `picsum.photos` 隨機圖 |
| 空狀態文案一致性 | 大致一致 | 抽查 12 處皆「尚無…／目前沒有…」樸素風格，無插圖 |

## 8. 外部資料來源

**完全沒有**。grep `dealsource|deal_source` 零命中；schema 無任何 Source/Feed/Crawler 模型。

---

## (b) P0/P1 風險清單（相對新願景）

- **P0｜Telegram「綁定成功但永遠收不到通知」**：綁定成功訊息承諾「之後有新的留言、直贈或交接通知，我會傳訊息到這裡」（`webhook/route.ts:160`），但初次發送管線不存在——對使用者的既成不實承諾。
- **P0｜若新文案宣稱支援票券/點數/資訊類好康**：目前完全無此三類，暗示支援即虛假宣傳。
- **P0（上線門檻）｜法務文件未經律師審閱**：新願景涉品牌好康聚合會放大商標/著作權/公平交易風險，非官方合作聲明目前不存在。
- **P1｜首頁假資料、無任何瀏覽/搜尋頁**：主動線斷裂。
- **P1｜公開列表 API 無防爬/節流**：聚合平台會吸引爬蟲。
- **P1｜M7/M8 後台頁是孤兒頁**：營運人員實際用不到。
- **P2｜條款無版本管理與同意紀錄**。

## (c) 可立即修正（小工作量高價值）

1. 首頁接上既有 `GET /api/items` ＋ 最簡搜尋結果頁。
2. `AdminNav` 補 4 個孤兒頁連結。
3. Telegram 補初次發送管線（可重用 `subscription-notify.ts:89-123` 的 dispatch 模式）或至少先改綁定成功文案。
4. 首頁 `picsum.photos` 假圖移除。
5. 頁尾/關於頁加「非官方合作」聲明。
6. KeywordBlocklist 後台 CRUD 頁。

## (d) 不建議現在做（過度工程風險）

- 同義詞/錯字容錯/pg_trgm 全文檢索（量級未到）
- 距離排序/地理座標（與縣市級定位衝突）
- LINE Messaging API（Telegram 管線都還沒通；每則推播付費）
- 獨立五類型狀態機重構（先用 type 欄位＋既有狀態機漸進）
- 外部來源自動爬蟲（法律風險最高，見法務報告）
- 管理員 2FA 自建（強制 Google 2SV 等效）

**不確定，需查證**：正式站 REQUIRE_REVIEW flag 是否開啟（DB 資料）；Telegram bot 正式站 webhook 是否已設（環境設定）；`/rules` 禁止品項清單是否涵蓋新指令品項。
