# GiveCircle（贈物網 m.give-circle.com）行動版參考研究

日期：2026-07-07。範圍：使用者指定「上線前最後衝刺」參考同類台灣平台，逐頁截圖後收斂
「可立即實作」與「backlog」兩級清單。**只參考版式與互動模式，不抄襲圖片素材、文案原句、
品牌元素**——本文件與後續實作皆用自己的文案與視覺（提案 B 靛青與暖沙）。

## 環境筆記（給之後 session 用）

Playwright 走這個環境的 proxy（`$HTTPS_PROXY=http://127.0.0.1:45547`）連到外部網站時，
Chromium 對 proxy 的 TLS 1.3 握手會被 `ERR_CONNECTION_RESET`（`curl`／`openssl s_client`
走同一個 proxy 完全正常，問題只發生在 Chromium）；加上啟動參數
`--ssl-version-max=tls1.2` 即可正常握手。另外這個 worktree 沒有自己的 `node_modules`
（`.gitignore` 排除），要跑 Playwright 前先 `ln -s /home/user/ShareGood/node_modules
node_modules`（symlink 本身不進版控，不影響 commit）。完整啟動參數見下方任一截圖腳本，
或直接參考本次 commit 歷史裡曾經用過的寫法。

## 逐頁截圖清單

以 iPhone 尺寸（390×844）、未登入訪客身分走訪，截圖存 `givecircle/`（見同目錄
下的 PNG/JPG，命名 `gc-*`）：

| 檔案 | 頁面 |
|---|---|
| `gc-01-home.jpg` | 首頁（`m.give-circle.com/`） |
| `gc-04-section-活動.png` | 活動頁（空狀態範例） |
| `gc-04-section-排行榜.png` | 上週分享排行榜 |
| `gc-04-section-感謝牆.png` | 感謝牆（空狀態） |
| `gc-06-gifts-list.png` | 禮物池列表（`/gifts`） |
| `gc-07-needs-list.png` | 需求池列表（`/needs`，含規則說明彈窗） |
| `gc-10-item-detail.jpg` | 物品詳情頁（`/gift/:id`） |
| `gc-11-search.png` | 搜尋頁（分類頁籤＋熱門禮物＋登入門檻彈窗） |
| `gc-13-user-profile.png` | 使用者公開檔案（`/user/:id`，非預期點擊帶出，但是很有價值的參考頁） |

**無法存取／放棄的部分**：需求池的單一需求詳情頁——多次嘗試點擊列表項目都被導去使用者
檔案頁（懷疑是 Vue SPA 的事件代理或廣告蓋層攔截點擊），放棄深入該頁；`/classify`、
`/category` 兩個推測路徑存在但實際回應內容跟首頁相同，判斷不是獨立分類瀏覽頁，未收錄。
底部導覽「訊息」「我的」兩個分頁對訪客一律彈回首頁（推測登入前置檢查在導覽層就擋掉），
沒有畫面內容可看，未收錄獨立截圖。

## 逐頁觀察與對照

### 1. 首頁（`gc-01-home.jpg`）
GiveCircle 首頁是密集的九宮格捷徑（活動／排行榜／說說／感謝牆／企業合作／新手教學／
GC 傳媒／永續報告／熱門禮物／心願認養），加上四個色塊分類卡（閃送／需求／禮物池／
心意牆）與跑馬燈式的即時動態（「XXX 發表了說說」）。這是典型「內容聚合站」版面，
捷徑多但初次訪客資訊負荷偏高。

對照我們的首頁（`src/app/(shell)/page.tsx`）：hero 搜尋框＋分類捷徑（第 37-107 行）→
熱門好物（第 110-167 行）→三步驟說明（第 169-205 行）→信任列（第 207-249 行）→CTA
（第 251-285 行），資訊架構單線、聚焦在「搜尋／瀏覽／上架」單一迴路，沒有 GiveCircle
那種多入口的內容聚合。**判斷：我們的版面已經比較克制，這點不需要往 GiveCircle 靠攏**
（ShareGood 定位是縣市級單一迴路平台，不是內容聚合站，硬加九宮格捷徑會偏離定位）。

### 2. 空狀態（`gc-04-section-活動.png`、`gc-04-section-感謝牆.png`）
活動頁的空狀態是「線稿插畫＋一句話＋返回首頁連結」，感謝牆則是吉祥物插畫＋无文字說明
（较弱的一版，缺一句話說明）。跟我們既有的 `src/components/empty-state.tsx`
（圖示＋標題＋說明＋選填 CTA）比，模式相同，只是我們用 lucide icon 不用插畫（M10 批次 3
的決定，避免動效／美術成本，見該元件註解）。**判斷：模式已經對齊，只是
`src/app/(shell)/items/page.tsx` 原本第 164-177 行的空狀態沒有套用共用元件，是純粹的
一致性缺口，可立即實作**（見下方清單第 1 項）。

### 3. 篩選互動（`gc-07-needs-list.png`）
需求池列表沒有內嵌篩選列，而是用一次性規則說明彈窗（先申請/後贈送/需求者可決定/…）
在進站時教育使用者。這對我們的參考價值有限，因為我們的先到先得留言機制比 GiveCircle
的「先申請、後贈送」規則單純，不需要額外規則彈窗。但截圖同時照出 GiveCircle 列表沒有
「清除篩選」之類的狀態提示，我們自己 `/items` 頁（`src/app/(shell)/items/page.tsx`）
篩選後也只能手動改網址回到無篩選狀態——這是我們自己現況的缺口，不是跟 GiveCircle學來的，
但既然截圖比對時發現了，一併列進可立即實作清單。

### 4. 列表卡片（`gc-06-gifts-list.png`）
禮物池卡片版式：正方形縮圖＋角標（送出/全新)＋標題＋社會認同文字（「等待有緣人」／
「剩餘:1」／「4人索取」）。社會認同數字（索取人數）是最值得學的一點，但我們現有
`listPublishedItems`（`src/lib/items.ts`）沒有查詢留言/認領數，要加需要改共用查詢函式
（同時被 `GET /api/items` 使用），且要決定「顯示留言數是否會助長搶留言的焦慮感」——
不屬於「單項 ≤1 小時、純前端」，**列入 backlog**（見下方）。

### 5. 物品詳情頁（`gc-10-item-detail.jpg`）
資訊層級由上而下：大圖＋標題浮貼在圖片下緣→流程/排隊/成交/運費/寄送/取件提示 icon 列→
分享者列（頭像＋暱稱＋「24小時內即將下架」倒數＋刊登時間）→分享到社群列（FB/LINE/
連結/追蹤）→地區→數量／剩餘→物品介紹→物品狀態/總價值→底部固定操作列（留言/分享/
我要索取）。

對照我們的 `src/app/(shell)/items/[id]/page.tsx`：分享者列（改動前原第 246-256 行）只有
「分享者：暱稱」＋檢舉按鈕，沒有刊登時間、沒有分享按鈕；互動區塊（現行第 336-379 行，
Zone 3「互動與交接」）是留言/直贈/抽籤/交接合併卡片，資訊架構其實比 GiveCircle 更清楚（GiveCircle 把留言/
分享/索取擠在同一條底部固定列，我們是分區塊各自展開）。**兩個可立即實作的落差**：
(a) 分享者列缺「刊登時間」的新鮮度提示；(b) 缺一顆隨手可分享出去的按鈕（GiveCircle
把分享做成核心操作之一，我們完全沒有——免費物資要靠使用者自發擴散，這點值得補）。
GiveCircle 的「物品狀態：二手／物品總價值：0~500元」需要新增欄位（我們的 Item model
沒有 condition／估值欄位，見 `prisma/schema.prisma` 第 296 行起的 Item model），
**列入 backlog**（違反本次「不動 schema」紅線）。底部固定操作列（sticky bottom bar）
牽動既有 ClaimsSection/DirectShareSection/LotterySection/HandoverSection 四個子元件的
版面邏輯，風險與工作量超過 1 小時，**列入 backlog**。

### 6. 使用者公開檔案（`gc-13-user-profile.png`）
驗證徽章（email/手機）、私訊/追蹤/分享連結三個操作、統計列（粉絲人數/說說/感謝率）、
年度分享/年度公益兩個大數字、送禮物/索取/需求/感謝/說說/心願認養六個分類連結（可展開
查看更多）。這是整組截圖裡對我們最有參考價值的一頁——我們的 `src/app/(shell)/u/[userId]/
page.tsx`（改動前僅 50 行）只顯示暱稱＋累計貢獻值一個數字，對第一次點進來的陌生訪客
不夠直覺（不知道這個數字代表什麼、對方是不是可信的分享者）。**可立即實作**：比照
GiveCircle 補上「完成分享／完成接手／收到感謝」三個具體次數（見下方清單第 4 項）；
驗證徽章／追蹤功能／分類明細清單需要新查詢＋（追蹤要新表）已超出範圍，**列入 backlog**。

### 7. 排行榜（`gc-04-section-排行榜.png`）
「上週分享排行榜」用前三名獎牌卡＋4-10 名清單，是很輕量但有效的社會認同/遊戲化機制。
我們有 `ContributionEvent` 可以算出類似排行，但做一個新頁面＋排行查詢＋（可能要考慮
排行榜是否會助長「刷分」動機）已經超出「純前端、≤1 小時」的範圍，**列入 backlog**。

### 8. 搜尋頁（`gc-11-search.png`）
分類頁籤（禮物池/閃送/需求池/會員/GC傳媒）＋熱門禮物榜，訪客點擊篩選會跳出「請先登入」
阻擋。我們目前沒有獨立搜尋頁，搜尋是 `/items?q=` 的一部分（見 `src/app/(shell)/items/
page.tsx` 第 92-98 行的搜尋框）。GiveCircle 把搜尋獨立成頁面主要是因為要塞多個分類頁籤，
我們的搜尋只對應單一物品列表，不需要跟進，**不列入任何清單**。

## 可立即實作清單（本階段已完成）

1. **`/items` 空狀態改用共用 `EmptyState` 元件＋加「清除篩選」連結**
   `src/app/(shell)/items/page.tsx:138-191`——篩選中才顯示的「清除篩選」chip（第
   163-174 行）＋空狀態換成 `EmptyState`（第 177-191 行），空狀態文案依是否有篩選條件
   分岔（找不到符合條件 vs 尚無物品上架），對應 CTA 也分岔（清除篩選看全部 vs 馬上分享）。
2. **物品詳情頁新增分享按鈕**
   新增 `src/components/share-link-button.tsx`（Web Share API 優先，不支援時 fallback
   複製連結到剪貼簿＋按鈕文字提示「已複製連結」2 秒，不依賴尚未掛上 Provider 的 sonner
   Toaster，見元件內註解），掛在 `src/app/(shell)/items/[id]/page.tsx:261-279` 的分享者
   資訊列。
3. **物品詳情頁分享者列補上刊登新鮮度提示**
   `src/app/(shell)/items/[id]/page.tsx:47-56`（`formatRelativePublished`）＋
   第 268 行套用：「剛剛上架／N 小時前上架／N 天前上架／N 個月前上架」，比對照組的絕對
   日期戳更快讓瀏覽者判斷這則資訊新不新鮮。
4. **公開個人頁新增信任信號統計列**
   `src/app/(shell)/u/[userId]/page.tsx:35-40`（新增三個併發查詢：完成分享次數
   `Item.count({ownerId, status: completed})`、完成接手次數
   `HandoverRecord.count({receiverId, status: completed})`、收到感謝則數
   `ThanksMessage.count({toUserId})`）＋第 55-67 行的三欄統計卡片，取代原本只有一個
   「累計貢獻值」數字、對陌生訪客不夠直覺的問題。

## Backlog（工作量大或需 schema，本階段不做）

- **列表卡片社會認同數字**（留言/認領人數）：需要改動 `src/lib/items.ts` 這支被
  `GET /api/items` 共用的查詢函式，且要先想清楚顯示人數會不會助長搶留言焦慮，非本階段
  ≤1 小時範圍。
- **物品狀態／估值欄位**（GiveCircle 的「二手／全新」「總價值 0~500 元」）：我們的
  `Item` model 沒有對應欄位，需要 schema 變更，違反本次紅線。
- **物品詳情頁底部固定操作列（sticky bottom bar）**：牽動
  ClaimsSection/DirectShareSection/LotterySection/HandoverSection 四個既有子元件的版面
  邏輯與顯示條件，風險與工作量超過單項 1 小時。
- **公開個人頁的驗證徽章／追蹤功能／分類明細清單**：追蹤功能需要新的關聯表（schema
  變更），分類明細清單（送禮物/索取/需求/感謝）需要多支新查詢＋分頁，超出本階段範圍。
- **上週分享排行榜**：需要新頁面＋排行查詢，且要先評估「排行榜會不會助長刷分動機」，
  留待之後有餘裕時當一個完整交付項目來做。

## 與並行分支可能衝突的檔案

本次改動的檔案：`src/app/(shell)/items/page.tsx`、`src/app/(shell)/items/[id]/page.tsx`、
`src/app/(shell)/u/[userId]/page.tsx`（新增檔案 `src/components/share-link-button.tsx`
不會衝突）。使用者派工說明指出 `src/app/(shell)/items/[id]/page.tsx` 有其他並行分支在改，
本次改動刻意只動分享者資訊列（第 262-277 行）與新增一個 helper function
（第 47-56 行），不動其餘既有結構，降低衝突面。`src/app/(shell)/items/page.tsx`／
`src/app/(shell)/u/[userId]/page.tsx` 未列在派工說明的並行清單中，風險較低。
