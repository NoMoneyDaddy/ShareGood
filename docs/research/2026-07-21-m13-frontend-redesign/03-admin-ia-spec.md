# M13 後台（/admin）資訊架構與視覺套用規格

範圍：`src/app/admin/**` 19 個路由（含 `legal-requests/[id]` 詳情頁）。前台不在本文件範圍內，
本文件假設前台規格會另外定義「在地地圖＋交接存根戳章」的共用元件與 design token 遷移，這裡
只負責點名沿用，不重新定義視覺基礎。

核心問題（使用者原話）：「後台目前偏功能導向，非工程背景的 moderator 上手困難」。這份規格的
每一節都圍繞這句話展開——先盤點現況為什麼難用，再說明新方案怎麼解。

---

## 0. 這份規格怎麼讀

1. **§1 視覺識別摘要**：定案版預覽（`m13-final-map-with-stamps.html`）萃取出的 token 對照表，
   後面所有小節都直接引用這裡的變數名稱。
2. **§2 現況問題盤點**：讀完全部 19 支 page.tsx 後歸納的具體問題，帶 file:line，證明「分散、
   扁平」不是憑空判斷。
3. **§3 後台導覽重新分組方案**：核心交付，含新的資訊架構、`AdminShell` layout 元件規格、
   值班總覽首頁重設計。
4. **§4 視覺語彙延伸規則**：戳章／熱點／純查詢三種呈現方式的決策矩陣，說明「什麼時候不套」。
5. **§5 分組路由細部規格**：四個分組＋首頁，逐路由寫改動內容、視覺套用、白話文案、手機版。
6. **§6 降低操作摩擦**：兩段式確認盤點、點擊路徑精簡清單。
7. **§7 降低學習摩擦**：新手導覽方案、術語白話化清單、空狀態／錯誤訊息檢視。
8. **§8 手機版轉換檢查清單**：逐路由確認。
9. **§9 與前台共用元件對照表**。
10. **§10 實作備註與待前台規格確認事項**。

---

## 1. 視覺識別摘要（從定案版 HTML 萃取）

來源：`m13-final-map-with-stamps.html`（`:root` 區塊，光色模式；深色模式為 `@media
(prefers-color-scheme: dark)` 與 `:root[data-theme="dark"]` 兩處鏡射定義，數值一致）。

### 1.1 核心色彩 token

| Token 名稱 | 淺色值 | 深色值 | 用途 |
|---|---|---|---|
| `--bg` | `#EBEFF5` | `#0E141F` | 頁面底色 |
| `--bg-map` | `#E1E7F1` | `#141C2A` | 地圖／看板底色（帶網格線） |
| `--bg-map-line` | `rgba(44,74,124,.08)` | `rgba(124,160,214,.10)` | 地圖網格線 |
| `--surface` | `#FFFFFF` | `#182234` | 卡片／面板底色 |
| `--surface-2` | `#F5F7FB` | `#1C2739` | 次要底色（表單輸入框等） |
| `--border` / `--border-strong` | `#CCD5E3` / `#A7B4C9` | `#2D3A50` / `#3E4E68` | 邊框 |
| `--ink` / `--ink-soft` / `--ink-faint` | `#16223A` / `#4C5A72` / `#7C8AA0` | `#E8ECF3` / `#ADBACD` / `#7C8AA3` | 文字三階 |
| `--brand`（群青） | `#2C4A7C` | `#82A6DA` | 主色：圖釘、連結、主要按鈕 |
| `--brand-deep` | `#1B3253` | `#5A80B8` | 頂部導覽底色、深色強調 |
| `--brand-tint` | `#DBE3F0` | `#223350` | 淺底（context-strip、選中態） |
| `--accent`（金黃赭） | `#B98A2E` | `#E3AC55` | 圖釘強調、進行中狀態 |
| `--accent-deep` / `--accent-tint` | `#8C6821` / `#F1E1BC` | `#C8933C` / `#3B2E17` | 強調色深/淺變體 |
| `--success` / `--success-tint` | `#2E9160` / `#DAF0E4` | `#4FB786` / `#163326` | 成功／已完成 |
| `--warning` / `--warning-tint` | `#D97B29` / `#F8E4CE` | `#E8964A` / `#3A2A17` | 警示／需留意 |
| `--danger` / `--danger-tint` | `#C0392B` / `#F5DAD6` | `#E2685A` / `#3B211F` | 危險／不成立／下架 |
| `--cat-furniture`…`--cat-voucher` | 6 組分類色 | 對應深色版 | **前台物品分類圖釘專用**，後台不直接沿用（見 §4.5 判斷） |
| `--shadow-c` | `27,50,83` | `0,0,0` | box-shadow 的 rgb 分量 |

字體堆疊：`--font-ui`（PingFang TC / Heiti TC / Microsoft JhengHei / Noto Sans TC 等）、
`--font-mono`（SF Mono / Menlo / Noto Sans Mono TC 等，用於時間戳、代號、數字）。
圓角：`--radius-s: 8px` / `--radius-m: 14px` / `--radius-l: 22px`。

**與目前正式站 token 命名的差異（協調事項，非本文件決定）**：目前 `src/app/globals.css` 用的
是 M11「提案 B 靛青與暖沙」命名（`--color-brand: #1E6B76`、`--color-brand-ink`、
`--color-paper`、`--color-ink` 等），跟這份定案版預覽的命名（`--brand: #2C4A7C`、`--ink`、
`--surface` 等，色碼也不同——群青＋金黃赭是全新配色，不是暖沙靛青的延伸）完全是两套。
**這份後台規格假設前台規格會先完成 token 遷移**（可能是重新命名 `--color-*` 系列變數並替換
色碼，也可能是新增一組後台專用的 CSS 變數並行存在），這裡直接引用定案版預覽的變數名稱撰寫，
實際 CSS 變數怎麼落地由前台規格拍板，後台開發時對照使用即可。

### 1.2 戳章元件（`.stamp` 系列）——後台「案件處理」類頁面的核心視覺語彙

造型：54px 圓形（清單內縮小版建議 22–24px，見 §4.2）、`transform: rotate(-6deg)` 模擬蓋歪的
橡皮章、內圈 `::after` 疊一圈 `opacity: .55` 的內框模擬複寫痕跡。**狀態不只靠顏色，靠邊框樣式**
（色弱使用者也分得出來）：

| 狀態 class | 邊框樣式 | 顏色 token | 語意 |
|---|---|---|---|
| `.stamp-done` | 實心 solid | `--brand` | 已完成 |
| `.stamp-active` | 虛線 dashed | `--accent-deep` | 進行中 |
| `.stamp-pending` | 點線 dotted | `--ink-faint` | 待辦 |
| `.stamp-void` | 雙線 double，`border-width:5px` | `--danger` | 作廢／異常（定案版預覽本身沒用到，僅列於圖例，後台會是第一個真正用上的地方，見 §4） |

### 1.3 熱點磚（`.hotspot` / `.heat-badge`）——巡查看板首頁的核心視覺語彙

`.hotspot` 是可點擊卡片（地點×分類＋數字圓章＋趨勢箭頭），`.heat-badge` 圓形數字徽章依
`data-level="low|mid|high"` 三級放大＋換色：

| 等級 | 尺寸 | 色彩 | 定案版預覽的量級定義 |
|---|---|---|---|
| `low` | 34px, font 13px | `--brand-tint` 底 / `--brand` 字 | 1–4 件（偶發） |
| `mid` | 40px, font 15px | `--accent-tint` 底 / `--accent-deep` 字 | 5–9 件（需留意） |
| `high` | 48px, font 18px，外加 `box-shadow` 光暈 | `--danger-tint` 底 / `--danger` 字 | 10 件以上（集中） |

`.hotspot-trend`：`↑ 較上週 +5`（`--danger` 字色，代表惡化）／`→ 與上週持平`／`↓ 較上週 -1`。

### 1.4 兩段式確認（強制下架「拔除標記」）

第一段「標示異常」只是 UI 提示（`.pin-anomaly` 紅色虛線外圈＋`.anomaly-tag` 標籤），**尚未真正
送出**；第二段跳出 `.modal-backdrop` + `.modal`，**必須完整覆誦物品標題**（`input` 比對，不符
時 `.btn-danger` 維持 `disabled`），並附 `.irreversible-note`（不可逆操作提示，寫入 AuditLog）。
這是後台所有「不可逆／高風險」操作的標準模式（見 §6）。

### 1.5 手機版導覽（漢堡＋抽屜）

`<768px` 隱藏桌面水平導覽列（`.navgroups { display:none }`），改顯示 `.hamburger-btn`
（44×44px，符合觸控目標）；點擊展開 `.nav-drawer`（從頂部導覽列下方滑出，`position:absolute;
top:100%`，內部依 `.nav-drawer-group` 分組＋`.nav-drawer-label`），互動邏輯：
`aria-expanded`、點外部關閉、`Escape` 關閉、關閉時焦點回到漢堡按鈕。`>=769px` 則 `.nav-drawer
{ display:none }`，桌面版永遠是水平導覽列，兩者互斥不共存。

---

## 2. 現況問題盤點（帶 file:line）

逐一讀完 19 支 page.tsx 後的具體發現，這是 §3 分組方案的論證基礎：

1. **導覽是單一扁平清單，17 個連結擠在一排 pill**：
   `src/app/admin/admin-nav.tsx:5-30` 的 `ADMIN_NAV_LINKS` 從「總覽」到「好康審核」一路排開，
   沒有任何分組、沒有視覺層級，新手 moderator 打開 `/admin` 第一眼看到的就是一整排無差別的
   按鈕。行為上「檢舉」「稽核紀錄查詢」「訴訟保全」「好康來源」混在同一排，使用者不知道
   哪些是自己每天要用的、哪些一輩子用不到一次。

2. **導覽本身就是碎片化的、不是每頁都有**：
   `src/app/admin/data/page.tsx`、`src/app/admin/legal-holds/page.tsx`、
   `src/app/admin/legal-requests/page.tsx` 三支完全沒有 import／渲染 `AdminNav`
   （對照 `src/app/admin/reports/page.tsx:5,31` 有掛）。`src/app/admin/ops/*` 四頁改用自己
   獨立的 `OpsNav`（`src/app/admin/ops/ops-nav.tsx`），**從 ops 頁面完全無法導覽回檢舉／申訴／
   使用者管理**，只能靠瀏覽器返回或手動改網址。這比「扁平」更嚴重——是**互不相連的孤島**。

3. **首頁待辦總覽只有 3 個數字，沒有分類/地區細分**：
   `src/app/admin/page.tsx:36-61` 只查 `pendingReports`／`pendingSupportTickets`／
   `pendingAppeals` 三個總數，看不出「哪一類檢舉最多」「是不是某個分類特別集中」，moderator
   要點進 `/admin/reports` 才知道細節，多一次跳轉。

4. **稽核紀錄的 action 代碼是原始系統代號，沒有白話翻譯**：
   `src/app/admin/audit-logs/page.tsx:138` 直接印 `{log.action}`（例如
   `item.force_remove`、`report.transition` 這類內部代號），只有 `targetType` 有
   `TARGET_TYPE_LABEL` 翻譯（`audit-logs/page.tsx:22-28`），`action` 完全沒有——這是最直接
   命中「非工程背景看不懂」的例子。

5. **危險操作的兩段式確認並不一致**：
   - `src/app/admin/items/force-remove-form.tsx` 目前只有「點按鈕展開表單→填原因→送出」
     **一段式**（無再次確認、無覆誦標題），跟定案版「拔除標記」規格（§1.4）要求的兩段式不符。
   - `src/app/admin/legal-holds/release-button.tsx:14` 用瀏覽器原生 `confirm()`——能用但
     不符合站內視覺語言，且不是「覆誦文字」的高強度確認。
   - `src/app/admin/legal-requests/[id]/legal-request-actions.tsx:43-46` 駁回用瀏覽器原生
     `prompt()` 輸入駁回原因；**核准（`handleApprove`）完全沒有任何確認步驟**，點下去立即呼叫
     API——這是實質的風險缺口，核准調閱請求會導致產生含真實個資的匯出包。
   - `src/app/admin/users/restriction-panel.tsx` 建立限制（含最高權限的 `full_block`
     全站封鎖）也是一段式表單直接送出。

6. **權限收斂邏輯藏在敘述性註解裡，前台完全沒有視覺提示**：
   例如 `/admin/appeals` 對 moderator 是整頁 404（`appeals/page.tsx:23-24`），
   `/admin/legal-holds`、`/admin/legal-requests` 對一般使用者也是 404，但**在導覽列表上
   這些連結跟其他連結長得一模一樣**（`admin-nav.tsx:14-17` 的註解承認「moderator 點進去 404
   也可以接受」）。moderator 點了才發現進不去，屬於可避免的挫折。

7. **內容密度高、缺白話說明**：多數頁面的說明文字（`<p className="mt-1.5 text-sm
   text-ink-soft">`）已經有一句話說明，但偏技術（例如 `data/page.tsx:52` 「系統每天清理時會
   依最新設定執行」還算白話，但 `legal-holds/page.tsx:47-49`「被保全的資料即使超過資料保留
   政策的期限，系統也不會自動清除」對沒聽過「資料保留政策」概念的人仍然是兩層陌生詞疊加）。

以上 7 點，尤其是 #1／#2／#4／#5，直接對應使用者說的「操作摩擦」與「學習摩擦」，是後面
所有改動的出發點。

---

## 3. 後台導覽重新分組方案

### 3.1 分組邏輯與理由

評估過兩種分法：
- **A. 按「處理案件」vs「查詢資料」vs「系統設定」分類**（功能性質）
- **B. 按「日常會用到」vs「偶爾才用」vs「admin 專屬高風險」分層**（使用頻率＋權限）

採用 **A 為主分組骨架、B 為每組內的排序與視覺強度依據**的混合方案，理由：

- 純粹按頻率分（B）沒辦法穩定分類——「檢舉」對一個每天巡邏的 moderator 是日常，但對一個
  只在假日兼職審核的 moderator 可能是「偶爾」，頻率因人而異，不該是最外層的分類依據。
- 純粹按功能分（A）比較穩定：檢舉／申訴／回報／物品／使用者都是「有人做了什麼、需要人工
  判斷去留」的**案件性質**，好康來源／好康審核／關鍵字黑名單是「維護內容庫與規則」的**內容
  治理性質**，稽核紀錄／成長指標／營運儀表板是「看數字、不用做決策」的**唯讀查詢性質**，
  資料保留／訴訟保全／調閱請求是「動到整個平台資料生命週期或涉及外部法律程序」的**系統與
  法務性質**——四種性質彼此互斥，功能上不會混淆。
- 但**組內排序＋視覺強度**採用頻率／風險（B）：案件處理組把「檢舉」「使用者回報」排最前面
  （量體最大、天天要看），「使用者管理」的限制建立表單用比檢舉列表更重的視覺分量（因為
  `full_block` 是全站級操作）；法務系統組整組用「鎖頭」視覺標記為 admin-only／高權限，
  跟其他三組明顯區隔開來，讓 moderator 一眼就知道「這區我大概率進不去，不用花時間找」。

最終四個功能分組＋一個值班中心首頁：

```
值班中心（首頁 /admin，不算導覽分組，是入口）
├── 案件處理　　　  日常會用到，量體最大，用戳章／熱點語彙
│   ├── 檢舉處理        /admin/reports
│   ├── 申訴複審        /admin/appeals            (admin-only)
│   ├── 使用者回報      /admin/support-tickets
│   ├── 物品管理        /admin/items              (含強制下架)
│   └── 使用者管理      /admin/users              (含限制/解除限制)
├── 內容治理　　　  偶爾用，好康資訊業務相關
│   ├── 好康來源        /admin/deal-sources
│   ├── 好康審核        /admin/deal-reviews
│   └── 關鍵字黑名單    /admin/keyword-blocklist
├── 數據與稽核　　  唯讀查詢，不做決策，用圖表非戳章
│   ├── 稽核紀錄        /admin/audit-logs
│   ├── 成長指標        /admin/growth
│   └── 營運儀表板      /admin/ops (+ storage/performance/notifications 四分頁)
└── 法務與系統　　  admin 專屬，高風險/低頻率，鎖頭視覺
    ├── 資料保留政策    /admin/data               (admin 可編輯，moderator 唯讀)
    ├── 訴訟保全        /admin/legal-holds        (admin-only)
    └── 調閱請求        /admin/legal-requests     (+ /[id] 詳情，不對外開放)
```

判斷取捨：「使用者回報」原本可能被歸進「內容治理」或「查詢」，但它本質上是**有人主動求助、
需要人工判斷去留（該不該處理、要不要轉交）**的案件性質，跟檢舉／申訴同一種心智模型（都是
「一個 queue，逐筆看，決定下一步」），所以放進案件處理組而非自成一類。「成長指標」跟
「營運儀表板」都是純查詢，但一個看產品數字、一個看工程健康度，維持 `admin-nav.tsx:19-20`
原本的既定切分理由（避免兩種性質的指標混在同一頁），只是這裡把兩者都收進同一個「數據與
稽核」大分組、用同一種視覺語言（圖表，不套戳章／熱點）。

### 3.2 AdminShell：從「每頁各自渲染 nav」改成統一 layout

現況（§2 問題 #2）是每個 page.tsx 各自決定要不要渲染 `AdminNav`，導致 `/admin/data`、
`/admin/legal-holds`、`/admin/legal-requests`、`/admin/ops/*` 都沒有共用導覽，變成孤島。

**改動**：新增 `src/app/admin/layout.tsx`（Next.js App Router layout，Server Component），
把權限檢查邏輯之外的「渲染分組導覽列」統一收進來，取代所有子頁各自呼叫 `<AdminNav
current="..." />`（以及 `ops/*` 的 `<OpsNav active="..." />`）。具體設計：

- `layout.tsx` 本身**不做權限檢查**（各頁仍保留自己的 `notFound()` 邏輯，因為
  `/admin/appeals`、`/admin/legal-holds` 等頁面的權限粒度比「moderator/admin 都能看」更細，
  不能收斂成一個共用檢查點，否則 admin-only 頁面對 moderator 就不再是「404 更精確地說是
  這頁面本來就不對你開放」而是被 layout 攔在更前面，語意上更難維護）。layout 只負責：
  1. 讀取目前登入者角色（`moderator` / `admin`，未登入或無角色時仍渲染 children，讓子頁自己
     決定 redirect/404，避免 layout 跟子頁的權限判斷出現兩套邏輯）。
  2. 渲染 `AdminShell`：桌面版是分組水平導覽列（比照 §1.5 的 `.navgroup` / `.navgroup-label`
     結構，但用在後台自己的次層導覽，不是最頂層的前台/後台切換），手機版是漢堡＋抽屜
     （直接沿用 §1.5、§9 的既有 CSS/JS 行為）。
  3. 分組內的連結**依角色動態隱藏**：`admin` 專屬的連結（申訴複審、訴訟保全、調閱請求）對
     `moderator` 直接不渲染，而不是渲染出來讓對方點了才 404——這是解決 §2 問題 #6 的直接
     手段。例外：`/admin/data` 對 moderator 是唯讀可見（不隱藏，只是頁面內少了編輯表單），
     所以「法務與系統」分組對 moderator 顯示時只留「資料保留政策」一個連結＋一個鎖頭圖示
     的分組標籤「法務與系統（部分內容僅管理者可見）」，比整組隱藏更誠實。
- 移除 `AdminNav`（`admin-nav.tsx`）與 `OpsNav`（`ops-nav.tsx`）兩個元件的舊邏輯，合併進新的
  `AdminShell` 內部：ops 四分頁改成 AdminShell 分組導覽下「數據與稽核」群組展開後的一層
  子分頁（沿用 `OpsNav` 現有的 pill 樣式作為第二層，不用重新設計）。
- 每個 page.tsx 的 `<AdminNav current="..." />` / `<OpsNav active="..." />` 呼叫全部移除，
  改由 layout 根據 `usePathname`（若 AdminShell 需要是 Client Component 才能讀 pathname，
  拆成 layout.tsx（Server）＋ `admin-shell.tsx`（Client，內部用 `usePathname()` 判斷
  active 狀態）兩層，維持原本「current 由外部傳入避免整包變 client bundle」的顧慮不成立，
  因為 layout 本來就需要互動式抽屜，本來就得是 client component 的子樹，不像原本
  `AdminNav` 是純展示的 server component）。

### 3.3 值班中心（`/admin` 首頁）重設計

沿用 §1.3 熱點磚語彙，取代現行 `page.tsx:74-86` 的三個純數字卡片：

- **三個核心待辦數字保留**（未處理檢舉／待處理使用者回報／待複審申訴），但改用 `.heat-badge`
  三級著色（沿用 §1.3 的 low/mid/high 門檻，數字沿用現有查詢邏輯 `page.tsx:36-40` 不變），
  點擊直接帶入對應列表頁並預設篩選成「非終態」（例如點「未處理檢舉」直接跳
  `/admin/reports?status=` 空字串＝全部未結案，而非要使用者自己點分頁篩選一次）。
- **新增一列「檢舉分類分佈」次要卡片**：不需要新 schema，`Report.category` 已存在
  （`reports-panel.tsx:12-19` 的 `CATEGORY_LABEL`），用 `db.report.groupBy({ by: ["category"],
  where: { status: { in: OPEN_REPORT_STATUSES } }, _count: true })` 即可算出，用跟 §1.3
  同樣的熱點磚樣式呈現「詐騙 3 件／私下收費 8 件／違禁品 1 件…」，讓 moderator 一眼看出
  今天該優先處理哪一類，而不用點進列表才知道。
- **已知限制、暫不做**：定案版預覽的熱點磚是「地點×分類」兩維度交叉（例如「台北市 ×
  優惠券」），但 `Report` 沒有直接掛城市欄位——檢舉對象若是物品才能透過
  `target.item.city` 反查，若對象是留言／私訊則無城市可歸屬。要做到跟預覽一樣的地點×分類
  交叉需要額外的 join 與「不分縣市」桶位設計，判斷為**中期加強項目**，v1 先做「純分類」
  一維分佈即可，不建議為了視覺一致性勉強拼湊一個資料不完整的地圖交叉表。
- **新增 7 天趨勢箭頭**：直接重用 `src/app/admin/ops/charts/date-buckets.ts` 已有的
  `lastNDayKeys` / `taipeiDateKey` 工具（`ops/performance/page.tsx:119-122` 已有前例），
  算出「本週新增檢舉數」對比「上週同期」，用 `.hotspot-trend` 的箭頭樣式標示於三個核心數字
  卡片與分類分佈磚上。

---

## 4. 視覺語彙延伸規則：戳章 vs 熱點 vs 純查詢

使用者要求的重點：「哪些狀態機適合用戳章造型呈現進度、哪些不適合」。以下是逐頁判斷矩陣，
附判斷理由——**不是每個有狀態欄位的頁面都套戳章**，這是本規格刻意的克制。

### 4.1 判斷原則

1. **戳章 track（多格連續步道，`.stamp-track`）只用在「線性、單向、每一步都真的會發生」的
   流程**。定案版預覽本身只在物品詳情頁的交接進度用了 track，因為那是「上架→留言→物主確認→
   私訊→完成」貨真價實的單向五步。後台目前 19 個路由裡，**只有 `/admin/legal-requests/[id]`
   調閱案件的狀態機（`submitted → legal_review → approved/rejected → fulfilled → closed`）
   夠格用完整 track**：低頻率、高儀式感（涉及正式公文與法律程序）、且快樂路徑確實是線性的
   （只有 approved/rejected 這一步有分岔，其餘都是單向前進）。
2. **戳章單章（`.stamp`，不連 track，只當作狀態徽章）用在「有分岔、無法保證線性、但仍然是
   『蓋一個章代表留痕』心智模型」的狀態欄位**：檢舉、申訴、使用者回報、DealInfo 審核、
   物品狀態、使用者限制生效狀態——全部改用單章徽章取代現有的 shadcn `Badge`，理由是視覺
   語彙統一（跟前台交接進度戳章、跟未來若有的其他狀態顯示一致），且邊框樣式（實心/虛線/
   點線/雙線）比純色塊更容易一眼分辨，對非工程背景使用者反而更好讀（不用去記「這個顏色的
   badge 代表什麼」，蓋章的「完成感」本身就有語意）。
3. **純查詢／唯讀頁面完全不套戳章或熱點**：稽核紀錄（`/admin/audit-logs`）、成長指標
   （`/admin/growth`）、營運儀表板四分頁（`/admin/ops/*`）。這些頁面的核心任務是「看數字、
   看趨勢」不是「處理一筆案件到某個狀態」，硬套戳章反而混淆——使用者可能誤以為稽核紀錄本身
   也有一個要推進的流程，但稽核紀錄只是唯讀日誌。這幾頁維持現有的圖表元件
   （`bar-chart.tsx` / `line-chart.tsx` / `status-timeline.tsx`，皆已遵循 dataviz 技能規範，
   套用 §1 的色彩 token 即可，不需要改造互動邏輯）。
4. **熱點磚（`.hotspot` / `.heat-badge`）只用在「總覽層級的量體視覺化」**：值班中心首頁
   （§3.3）與（未來若做）好康審核佇列量體提示。**不用在**個別案件列表本身——檢舉列表、
   申訴列表都是「逐筆處理」的清單，用熱點磚的大圓數字反而失焦（熱點磚設計是給「這裡有多少
   案子」的匯總視角，不是給「這一筆案子現在什麼狀態」）。

### 4.2 單章徽章尺寸與狀態對照表（取代現有 `Badge` 元件）

新增一個共用元件 `StampBadge`（後台專用，前台若已有交接進度戳章元件則後台直接 import 共用
底層樣式，見 §9），提供 `size="inline" | "prominent"` 兩種尺寸：`inline`（22–24px，清單行內
使用）、`prominent`（40–54px，詳情頁單一狀態展示，例如調閱案件詳情頁最上方）。

| 頁面／欄位 | 狀態值 | 對照 stamp 樣式 | 備註 |
|---|---|---|---|
| 檢舉 `Report.status` | `submitted`／`triaged`／`in_progress` | `.stamp-active`（虛線，accent） | 三個都算「還在走」，不需要進一步細分視覺，靠文字標籤區分 |
| | `resolved` | `.stamp-done`（實心，brand） | 成立 |
| | `rejected` | `.stamp-void`（雙線，danger） | 不成立/駁回 |
| | `closed` | `.stamp-pending` 但文案改「已封存」 | **刻意的取捨**：點線灰色原本語意是「待辦」，但 closed 是「已經處理完、封存」不是「還沒開始」。若照搬點線樣式容易讓人誤讀成「還有事沒做」，因此在 closed 狀態旁邊必須加文字「已結案封存」而非只靠視覺，不能只套用視覺不管語意誤讀風險 |
| 申訴 `Appeal.status` | `pending` | `.stamp-active` | |
| | `approved` | `.stamp-done` | |
| | `rejected` | `.stamp-void` | |
| 使用者回報 `SupportTicket.status` | `open` | `.stamp-pending` | 尚未有人認領處理，語意上真的是「待辦」，跟上面 closed 的取巧不同 |
| | `in_progress` | `.stamp-active` | |
| | `resolved` | `.stamp-done` | |
| | `closed` | `.stamp-pending` + 「已結案封存」文案（同檢舉的取捨） | |
| 物品狀態（`/admin/items`） | `draft`／`pending_review` | `.stamp-pending` | |
| | `published`／`reserved`／`handover_pending` | `.stamp-active` | 都是「還在流通中」 |
| | `completed`／`expired` | `.stamp-done` | 自然終態，非負面 |
| | `removed_by_user`／`removed_by_moderator` | `.stamp-void` | 強制或自行下架都是「作廢」語意 |
| 使用者限制（`/admin/users`） | 生效中 | `.stamp-active`（warning 色而非 accent，見下方例外） | |
| | 已解除 | `.stamp-done` | |
| DealInfo（`/admin/deal-reviews`，未來 `/admin/deal-infos` 若有後台管理） | `pending_review` | `.stamp-active` | |
| | `published` | `.stamp-done` | |
| | `stale` | `.stamp-active` **+ 額外疊加一個小驚嘆號 icon**（不新增第 5 種邊框樣式） | **判斷取捨**：stale 語意是「已有人回報失效但還沒到硬性 TTL」，跟一般「進行中」不同、需要引起注意，但為了不稀釋 §1.2 已定案的四態邊框系統（增加第五態會讓色弱使用者的分辨系統變複雜），改成在既有虛線章上疊加一個小圖示做語意加強，而非發明新邊框樣式 |
| | `expired`／`rejected` | `.stamp-void` | |

例外說明：使用者限制的「生效中」用 `--warning` 而非 `--accent-deep`，因為限制本身是對使用者
的處罰性動作，跟「檢舉正在處理中」的中性進行語意不同，沿用 `--warning` 系列在心理上更貼近
「這個人現在被限制住」的警示感——這是唯一一處在 stamp 顏色上做語意例外，其餘一律照
§1.2 表格。

### 4.3 需要完整 `.stamp-track` 的唯一頁面：調閱案件詳情

`/admin/legal-requests/[id]` 頂部新增一條 5 格戳章步道：

```
建檔 → 法務審閱中 → 核准/駁回（分岔點） → 已交付 → 已結案
```

- 若 `rejected`：第三格改成 `.stamp-void`，第四、五格維持 `.stamp-pending`（不會再推進，但
  仍保留在 track 上讓使用者看到「這條路走不下去了」，而不是把後面步驟直接砍掉——沿用定案版
  「作廢仍保留紀錄」的哲學）。
- 每格底下標記時間戳（沿用 `request.events` 現有的時間序資料，`legal-requests/[id]/page.tsx:
  158-167` 已經有 `EVENT_ACTION_LABEL` 可以對應到每一格的完成時間，不需要新查詢）。

### 4.4 熱點磚在案件處理組的延伸：檢舉／回報列表頁的「量體提示條」

檢舉列表頁（`/admin/reports`）、使用者回報列表頁（`/admin/support-tickets`）在篩選 tab 上方
各加一條迷你熱點提示（不是完整 `.hotspot-grid`，是單排小徽章），顯示目前分類/狀態分佈，
點擊即套用對應篩選——這是 §3.3 值班中心分類分佈磚的頁內延伸版，讓使用者從總覽點進來後，
在列表頁本身也能持續看到「還剩下什麼」而不用每次回首頁確認。

### 4.5 為什麼不直接沿用前台的 `--cat-*` 物品分類色

前台的 6 個 `--cat-*` token（傢俱大型物、家電、美妝保養等）是**物品分類**専用的色彩系統，
跟後台會用到的分類概念（檢舉類別：詐騙/私下收費/違禁品/食品疑慮/騷擾/其他；好康審核／來源
等級 S0-S5）是完全不同的分類體系，語意上不該共用同一組顏色（例如檢舉類別「食品疑慮」若
借用 `--cat-books`「書籍雜誌」的紫色，兩者會誤導使用者以為有某種對應關係）。**後台不新增
第二組分類色 token**：檢舉分類分佈磚（§3.3、§4.4）改用 §1.3 既有的熱點磚三階（低/中/高）
純量體著色，分類本身用文字標籤區分而非顏色，避免無限增生調色盤。

---

## 5. 分組路由細部規格

### 5.1 值班中心（`/admin`）

已於 §3.3 完整說明。額外白話文案：頁面副標題現行「治理底線工具：檢舉處理、下架、使用者
限制、申訴複審、稽核紀錄」（`page.tsx:66-67`）改寫成更像跟新手主管解釋的口氣：

> 「這裡是後台的第一站——上面三個數字是現在最需要你處理的事，數字越大代表越急。下面分成
> 四大區：案件處理（你每天大概都會用到）、內容治理、數據與稽核（純粹看數字，不用做決定）、
> 法務與系統（大部分只有管理者看得到）。」

### 5.2 案件處理組

#### 5.2.1 檢舉處理 `/admin/reports`

- 視覺：狀態改用 §4.2 的 `StampBadge`（inline size）取代 `STATUS_VARIANT`/`Badge`
  （`reports-panel.tsx:30-37`）；卡片本身維持現有「同頁展開處理」的既定模式
  （`ReportCard` 內直接展開處理表單，不跳轉），這個模式**已經符合「同頁展開，不用來回跳轉」
  的操作摩擦精簡原則，保留不動**。
- 桌面加強：仿定案版「檢舉處理佇列」畫面的雙欄佈局（列表在左、處理面板在右 `sticky`），
  作為 `>=880px` 時的加強版排列（目前是單欄卡片，改為雙欄後點選左側案件，右側處理面板
  即時切換內容，不需要往下捲動到卡片內部找表單）；`<880px` 維持現有單欄展開模式（跟定案版
  預覽自己在窄螢幕把 `process-panel` 改回 `position:static` 的原則一致）。
- 學習摩擦：「結案必填處理備註」目前只在送出失敗才顯示錯誤（`reports-panel.tsx:230-234`），
  改成在按鈕旁常駐顯示「駁回或標記已解決前，請先寫一句處理備註，之後要追蹤時看得到你當初
  為什麼這樣判斷」，把「必填」的原因說清楚而不只是規則。
- 兩段式確認：`resolved`／`rejected` 屬於結案性質但可逆（`resolved`/`rejected` 之後還能再轉
  `closed`，且申訴機制可以推翻），**維持現行一段式**（填備註即送出）即可，不需要比照強制
  下架的覆誦式確認——過度確認會拖慢真正的日常量體最大的頁面，跟操作摩擦精簡的目標衝突。

#### 5.2.2 申訴複審 `/admin/appeals`（admin-only）

- 視覺：`StampBadge` 取代現有 `Badge`（`appeals-panel.tsx:16-20`）。
- **核准需要兩段式確認**（現況只需要填 `reviewNote` 即送出，`appeals-panel.tsx:205-237`）：
  核准申訴會觸發「物品轉回 published」或「解除使用者限制」的原子復原（見
  CLAUDE.md M2 記載），這是實質的權限/內容復原操作，建議跟強制下架同等級——**但不需要覆誦
  文字**（申訴案件沒有像物品標題那樣好記誦的單一字串，改成沿用定案版 modal 樣式、把
  `reviewNote` 的內容摘要顯示在確認彈窗裡「你即將核准這則申訴，物品／限制將復原為正常狀態，
  確定嗎？」，按確認才真的送出）。駁回維持一段式（駁回是保守選項，不需要額外摩擦）。
- 白話文案：`RESTRICTION_TYPE_LABEL`（`appeals-panel.tsx:30-35`）已經是白話中文，保留；
  加一句頁面說明「申訴＝被下架或被限制的人，如果覺得處理不公平，可以提出一次申訴，由管理者
  重新審查。核准會自動復原原本的下架/限制，駁回則維持原本的處置。」

#### 5.2.3 使用者回報 `/admin/support-tickets`

- 視覺：`StampBadge` 取代 `STATUS_VARIANT`（`support-tickets/page.tsx:27-31`）。
- 「認領」機制（`assigned=me`/`unassigned`）已經是合理的分派摩擦精簡設計，保留。
- 白話：頁面說明現行「功能異常與帳號問題回報的後台處理列表」偏功能性，改為「使用者在
  `/support` 送出的問題（bug、帳號問題等），這裡可以認領給自己處理、留言溝通、標記進度。」

#### 5.2.4 物品管理 `/admin/items`（含強制下架）

- **強制下架升級為真正的兩段式確認**（現況缺口見 §2 問題 #5）：
  1. 第一段「標示異常」：點擊「強制下架」按鈕後，展開的不再是直接可送出的表單
     （`force-remove-form.tsx:53-96`），而是先顯示 §1.4 定案版的 `.pin-anomaly` /
     `.anomaly-tag` 樣式，把「下架原因」「備註」欄位填完後按「準備下架」只是**暫存本地
     state，不呼叫 API**。
  2. 第二段：跳出 `.modal-backdrop` 覆誦確認彈窗，比照定案版：`.modal-quote` 顯示完整物品
     標題，`input` 要求逐字輸入相符才能啟用「確認下架」，`.irreversible-note` 明確寫「下架
     後無法復原，物主僅能提出申訴」。確認送出才真的呼叫既有的 `PATCH
     /api/items/[id]/force-remove`（API 本身不用改，只改前端的確認流程）。
- 視覺：物品狀態改用 §4.2 對照表的 `StampBadge`。
- 白話：`STATUS_LABEL`（`items/page.tsx:15-25`）已是中文白話，保留；加一句「強制下架是不可
  逆操作，物主只能事後申訴，請先確認原因清楚、必要時附上檢舉紀錄佐證。」

#### 5.2.5 使用者管理 `/admin/users`（含限制/解除限制）

- **建立限制的兩段式確認，依風險分級**：`full_block`（全站封鎖）比照強制下架走覆誦式二次
  確認（覆誦使用者暱稱或 email）；`no_posting`／`no_claiming`／`no_messaging` 三種局部限制
  維持一段式（風險較低，且都有到期日可設，不是永久性最高懲罰，不需要拖慢日常量體）。
  這個「依風險分級決定要不要上兩段式」的原則同樣適用於 §5.2.2 的申訴核准與 §5.4.2 的
  訴訟保全解除。
- 視覺：使用者限制生效狀態改用 §4.2 對照表的 `StampBadge`（warning 色系）。
- 白話：`RESTRICTION_TYPE_OPTIONS`（`restriction-panel.tsx:8-13`）標籤已經白話，保留；
  在 `full_block` 選項旁加輔助文字「這個人完全看不到、也不能操作任何東西，通常只在嚴重違規
  時使用，請謹慎。」

### 5.3 內容治理組

#### 5.3.1 好康來源 `/admin/deal-sources`

- 視覺：`sourceGrade`（S0–S5，`deal-sources-panel.tsx:211`）目前只印代號本身，容易讓非工程
  背景使用者不知道 S0 跟 S5 誰比較可信。加一個白話對照（可放在頁面說明或 tooltip）：
  「S0/S1＝官方直接來源，最可信；數字越大代表越間接、需要越小心查證」（實際分級定義請前台
  規格或既有研究文件 `docs/research/2026-07-06-deal-aggregation/` 確認精確措辭，這裡先給
  方向）。
- 「標記已查證」「停用/啟用」維持一段式操作（低風險，可逆），不需要戳章／二次確認。

#### 5.3.2 好康審核 `/admin/deal-reviews`

- 視覺：`StampBadge` 可選用於單筆狀態展示，但目前頁面只列 `pending_review` 佇列本身沒有
  顯示狀態欄位（核准/駁回後就從列表消失，`deal-review-row.tsx:45-46` 送出後 `router.
  refresh()`），維持現況即可，不需要額外加戳章（佇列本身的「消失」已經是最清楚的完成信號）。
- 白話：頁面說明已經清楚（`deal-reviews/page.tsx:56-58`），保留。

#### 5.3.3 關鍵字黑名單 `/admin/keyword-blocklist`

- 純 CRUD，維持現況一段式操作，`isActive` 用簡單開關樣式（不需要戳章）。
- 白話：說明文字已清楚（`keyword-blocklist/page.tsx:48-50`），保留。

### 5.4 法務與系統組（admin 專屬視覺標記）

整組導覽標籤加一個小鎖頭圖示（沿用定案版 SVG symbol 庫的風格新增 `ic-lock`，或使用
lucide-react 現成的 `Lock` icon，與其餘圖示風格一致即可），文案「法務與系統（多數僅管理者
可見）」。

#### 5.4.1 資料保留政策 `/admin/data`

- **白話重寫是這頁最需要的改動**：目前 `data/page.tsx:50-53` 的說明「保留天數與到期後的
  處理方式都可以在這裡調整，系統每天清理時會依最新設定執行」已經不錯，但「保留天數」「動作」
  兩個欄位本身（`action` 為 `purge`/`anonymize`/`downgrade`/`archive`，見
  `retention-policy-row.tsx:19`）對非工程背景使用者是全新詞彙。加一段白話說明區塊（頁面
  頂部，摺疊式或常駐皆可）：

  > 「資料保留政策是在說：某一類資料（例如已刪除帳號的個資、已到期物品的圖片）放多久之後，
  > 系統會自動幫你處理掉。『不自動清理』代表這類資料永遠留著、系統不會主動碰它。
  > 『動作』有四種：**刪除**（真的砍掉）、**去識別化**（留下紀錄但看不出是誰）、
  > **降級保存**（搬到比較便宜但存取較慢的地方）、**封存**（原封不動搬去備份，之後很少用到
  > 才需要）。」

- 「清除紀錄」表格的「是否被訴訟保全擋下」欄位（`data/page.tsx:112,128`）加一句輔助文字：
  「『是』代表這筆資料本來該被清理，但因為有訴訟保全掛著，系統跳過了，沒有真的處理。」
- 不需要戳章：這是設定頁＋唯讀日誌的混合，不是案件處理，維持現行表格樣式，只做視覺 token
  替換（新色彩系統）與白話文案補強。

#### 5.4.2 訴訟保全 `/admin/legal-holds`（admin-only）

- **白話重寫**：現有說明（`legal-holds/page.tsx:47-49`）已讀過，改寫更直白：

  > 「訴訟保全＝把某些資料『先冰起來』。就算資料保留政策設定的期限到了，只要有保全掛著，
  > 系統就不會自動刪除或處理它——通常用在正在調查中的案件，避免關鍵證據被自動清掉。
  > 案件結束後記得解除保全，資料才會恢復正常的清理排程。」

- 建立保全的 `targetType`/`targetId` 手動輸入（`legal-hold-form.tsx:69-77`）對非工程背景
  使用者是不友善的（要自己知道 `user`/`item`/`conversation`/`message` 這些內部代號跟去哪裡
  找 ID）。**中期改善建議**（不在本次規格必做範圍，先記錄）：改成「貼一個網址（例如物品
  詳情頁 `/items/xxx` 或使用者個人頁 `/u/xxx`）自動解析出 targetType/targetId」，比手動輸入
  代號更直覺；v1 先把 placeholder 文字寫更清楚（「目標類型：user（使用者）／item（物品）／
  conversation（對話）／message（單則訊息）」，把中文說明直接放進 placeholder 而非只有
  英文代號）。
- **解除保全升級為戳章化二次確認**：目前用瀏覽器原生 `confirm()`（`release-button.tsx:14`），
  改成站內樣式的 modal（沿用 §1.4 的 `.modal` 結構，不需要覆誦文字，因為解除保全不像刪除
  物品那樣不可逆——解除後可以重新建立——用一般的「確認／取消」雙按鈕彈窗即可，比原生
  `confirm()` 更符合視覺一致性，但不用拉到覆誦文字這麼重的等級）。

#### 5.4.3 調閱請求 `/admin/legal-requests` ＋ `/admin/legal-requests/[id]`（不對外開放）

- **白話重寫**：

  > 「這裡是警察或檢察官因為辦案需要，正式發文要求我們提供特定使用者資料時使用的頁面。
  > 一般使用者完全看不到、也進不去這裡。規則是『雙人審核』：建檔的人不能自己核准自己建立的
  > 案子，一定要換另一位管理者複核，避免球員兼裁判。」

- 案件列表頁（`/admin/legal-requests`）保留現狀（純列表＋建檔表單）。
- 案件詳情頁（`/admin/legal-requests/[id]`）**新增 §4.3 的完整戳章步道**，取代現行只有
  一個 `Badge` 顯示目前狀態（`legal-requests/[id]/page.tsx:76`）。
- **核准動作補上確認步驟**（現況完全沒有，見 §2 問題 #5 是實質風險缺口）：
  `legal-request-actions.tsx:23-41` 的 `handleApprove` 改成先跳確認彈窗，說明「核准後這個
  案件會進入可產生匯出包的狀態，匯出包會包含使用者的真實個資，請確認公文內容與調閱範圍
  正確無誤」，確認後才呼叫 API。
- **駁回原因輸入從 `prompt()` 升級成站內 `Textarea` 彈窗**（`legal-request-actions.tsx:
  43-46` 目前用瀏覽器原生 `prompt()`，樣式突兀且不支援多行編輯），改用跟 §1.4 一致的
  `.modal` + `Textarea`。
- 「產生匯出包」「下載」維持現行按鈕形式（`legal-request-actions.tsx:67-83,109-148`），但
  下載動作因為涉及真實個資，**加一行不可忽略的提示文字**（常駐顯示，不是 hover 才看到）：
  「下載連結 15 分鐘內有效，請透過受保護管道轉交，不要用一般 email 或即時通訊直接夾帶。」

### 5.5 數據與稽核組（唯讀，不套戳章/熱點）

#### 5.5.1 稽核紀錄 `/admin/audit-logs`

- **補上 `action` 白話對照表**（§2 問題 #4 的直接解法）：新增 `ACTION_LABEL: Record<string,
  string>`（比照既有 `TARGET_TYPE_LABEL` 的寫法），至少涵蓋目前系統會寫入的高頻動作代號
  （`item.force_remove`／`report.transition`／`appeal.review`／`user_restriction.create`／
  `user_restriction.lift`／`legal_hold.create`／`legal_hold.release`／
  `legal_request.approve`／`legal_request.reject` 等，實際完整清單需要 grep
  `writeAudit(` 呼叫點統整，這裡先列出讀 page.tsx 時已知涉及的幾支 API）。UI 呈現
  「白話說明（原始代碼）」的格式，例如「強制下架物品（item.force_remove）」，工程師仍能看到
  原始代碼，非工程背景的人看得懂白話那一半。
- `detail` 欄位目前是 `JSON.stringify(log.detail)` 直接印原始 JSON（`audit-logs/page.tsx:
  151-155`），對非工程背景使用者是天書。**建議**：常態顯示保持摺疊（例如預設只顯示前 80
  字或一個「查看詳細內容」展開按鈕），展開後才顯示原始 JSON，並在旁邊加一句「以下是系統
  記錄的詳細資訊，格式是給工程除錯用的，一般情況不需要看懂它」，降低「看到一堆看不懂的
  符號」造成的畏懼感。
- 不套戳章：這是唯讀日誌，`sensitive` 欄位維持現有 `Badge variant="destructive"`（
  `audit-logs/page.tsx:140`）即可，只做色彩 token 替換。

#### 5.5.2 成長指標 `/admin/growth`

- 現況說明文字已經是全站數一數二白話的頁面（`growth/page.tsx:49-51,73-75,89`），保留不動，
  只做視覺 token 替換。
- 三個指標卡片視覺加強：現行純數字卡片可以加小型 sparkline（利用既有的 `date-buckets.ts`
  工具重繪近 N 週趨勢），非必要但屬於加分項，不影響核心資訊架構，列為可選加強。

#### 5.5.3 營運儀表板 `/admin/ops`（+ storage/performance/notifications）

- **這四頁刻意維持技術導向，不做白話化降級**：這是本規格唯一一組主張「不用特別遷就非工程
  背景」的頁面，理由是它的核心受眽本來就偏工程（P95、慢查詢、資料庫子系統健康度），CLAUDE.md
  記載這是給「工程健康指標」用的儀表板，跟案件處理類頁面的目標使用者（一般 moderator）不同。
  這是刻意的範圍克制：**不是每一頁都要為了「降低學習摩擦」而稀釋掉原本服務工程受眾的精確度
  ——把兩種受眾混在一起改，反而會讓工程師覺得資訊變得模糊。**
- 唯一必做的改動：把 `OpsNav` 併入 §3.2 的 `AdminShell`（不再獨立於整體導覽之外），並把色彩
  token 換成 §1 的新配色（現有的 `TrendBarChart`/`TrendLineChart`/`StackedBarChart` 元件邏輯
  不變，只換色票）。

---

## 6. 降低操作摩擦：兩段式確認盤點與點擊路徑精簡

### 6.1 兩段式確認（覆誦式，比照強制下架）該用在哪

| 操作 | 現況 | 建議 |
|---|---|---|
| 強制下架物品 | 一段式 | **升級為覆誦標題二段式**（§5.2.4） |
| 建立 `full_block` 限制 | 一段式 | **升級為覆誦暱稱/email 二段式**（§5.2.5） |
| 建立局部限制（no_posting 等） | 一段式 | 維持一段式 |
| 核准申訴 | 一段式（只需填備註） | **升級為說明式確認彈窗**（不需覆誦文字，§5.2.2） |
| 駁回申訴 | 一段式 | 維持一段式 |
| 解除訴訟保全 | 原生 `confirm()` | **升級為站內樣式確認彈窗**（不需覆誦，§5.4.2） |
| 核准調閱請求 | **無任何確認（風險缺口）** | **新增說明式確認彈窗**（§5.4.3） |
| 駁回調閱請求 | 原生 `prompt()` | **升級為站內 Textarea 彈窗**（§5.4.3） |
| 檢舉結案（resolved/rejected） | 一段式（填備註） | 維持一段式（量體大，過度確認會拖慢日常工作） |
| 好康來源標記查證/停用 | 一段式 | 維持一段式（低風險、可逆） |
| 關鍵字黑名單新增/停用 | 一段式 | 維持一段式（低風險、可逆） |

判斷準則：**「不可逆」或「影響範圍是全站級/涉及真實個資外流」才升級到二段式，其餘維持
一段式**——這是刻意的取捨，避免把「兩段式確認」當成無腦套用在所有危險字樣按鈕上的萬用藥，
那樣量體最大的檢舉／回報處理反而會被拖慢，違背「少點擊、流程短」的核心目標。

### 6.2 點擊路徑精簡清單

| 現況路徑 | 問題 | 精簡後 |
|---|---|---|
| 值班中心看到「18 件未處理檢舉」→ 點「未處理檢舉」卡片 → 到 `/admin/reports` → 還要自己點篩選 tab | 多一次篩選動作 | 帶入 query param 直接套用篩選（§3.3） |
| ops 任一分頁 → 想看檢舉 → 只能改網址或瀏覽器返回 | 完全斷聯 | AdminShell 統一導覽解決（§3.2） |
| 稽核紀錄想確認「這筆強制下架是誰核准的」→ 只能到 `/admin/audit-logs` 手動輸入 targetId 查詢 | 要先知道 targetId 才查得到 | `/admin/items` 物品卡片、`/admin/appeals` 申訴詳情都已經有連向物品/使用者的連結，建議在這些連結旁**新增一個「查看相關稽核紀錄」捷徑連結**，直接帶 `targetType`/`targetId` query param 跳轉到 `/admin/audit-logs?targetType=item&targetId=xxx`，不需要使用者手動輸入 |
| 檢舉列表點進案件 → 讀完內容 → 處理 → 送出 → 留在同一頁（已經是好設計） | 無 | 維持不變，這是現有做得對的地方 |

---

## 7. 降低學習摩擦

### 7.1 新手 moderator 第一次登入後台的引導方案

**重用既有機制**：前台已有 `src/components/onboarding-tour.tsx`（M11，coachmark 卡片式導覽，
非真實 DOM spotlight，`localStorage` 存 `tour_done` 旗標，可從 `/me` 重新打開）。後台直接
複用同一套元件實作模式（同樣的置中卡片＋步驟點＋跳過/上一步/下一步邏輯），開一個獨立實例：

- 新增 `localStorage` key：`admin_tour_done`（獨立於前台的 `tour_done`，因為兩者受眾與觸發
  時機不同——一個人可能是一般使用者也是 moderator，兩套導覽各自只在對應情境觸發一次）。
- 觸發時機：`AdminShell`（§3.2）掛載時，若目前使用者角色含 `moderator`/`admin` 且
  `localStorage` 無 `admin_tour_done`，自動彈出。
- 步驟內容（5 步，比照前台 `OnboardingTour` 的步數與圖示語言）：
  1. 「這是你的值班中心」——說明首頁三個數字＋分類分佈磚怎麼看，數字越大越急。
  2. 「案件處理是你的日常」——說明檢舉/申訴/回報/物品/使用者五個入口都在同一組，逐筆處理
     完會自動從清單消失。
  3. 「危險操作會多問你一次」——說明強制下架/建立封鎖這類操作為什麼要覆誦文字才能送出，
     這不是系統故障，是刻意設計來防止手滑。
  4. 「法務與系統大部分你進不去」——說明鎖頭標記的分組是管理者專屬，看不到不是權限錯誤。
  5. 「有問題怎麼辦」——引導到（若有）內部文件連結或客服管道；若無此類文件，改成「不確定
     怎麼處理可以先標記『處理中』，跟其他管理者討論後再決定，不用怕做錯決定」。
- `/me` 中心頁（前台既有頁面）比照現行「重新看一次導覽」按鈕邏輯（`restartOnboardingTour()`）
  新增第二顆按鈕「重新看一次後台導覽」（僅 moderator/admin 看得到），呼叫對應的
  `restartAdminOnboardingTour()`。

### 7.2 術語白話化清單彙整

（逐項已在 §5 各節說明，這裡彙整成單一檢查清單方便實作時對照）

- [ ] 稽核紀錄 `action` 代碼：補 `ACTION_LABEL` 對照表（§5.5.1）
- [ ] 資料保留政策：新增白話說明區塊解釋「保留天數」「四種動作」「訴訟保全擋下」（§5.4.1）
- [ ] 訴訟保全：重寫頁面說明＋ `targetType` placeholder 白話化（§5.4.2）
- [ ] 調閱請求：重寫頁面說明強調「雙人審核」「一般人看不到」（§5.4.3）
- [ ] 好康來源 `sourceGrade` S0-S5：加白話對照（§5.3.1）
- [ ] 使用者限制 `full_block` 選項：加「請謹慎」輔助文字（§5.2.5）

### 7.3 空狀態與錯誤訊息的「非工程背景看得懂嗎」檢視

逐頁盤點目前的空狀態文案（例如「目前沒有符合條件的檢舉」`reports-panel.tsx:178-180`、
「沒有符合條件的物品」`items/page.tsx:140-142`、「尚無檢查紀錄」`ops/page.tsx:142`）——
**這些已經是白話中文，沒有內部代號外露的問題**，維持現狀即可，不需要大改。真正需要修的是
**成功/失敗訊息**：多數頁面的 catch block 統一寫「網路連線異常，請重新整理再試一次」/
「操作失敗，請再試一次」（例如 `reports-panel.tsx:130`、`force-remove-form.tsx:47`），這是
好的一致模式，**保留**；但 API 回傳的 `data?.error?.message` 若本身是英文技術訊息（例如
Zod 驗證錯誤原始字串），會直接顯示給使用者看到英文報錯——這不在本文件範圍內（屬於 API 層級
的錯誤訊息在地化，需要另外盤點所有 API route 的 error message 是否全繁中），這裡先記錄成
待前台/後端規格確認事項（見 §10）。

### 7.4 「法務與系統」分組的鎖頭視覺是學習摩擦的直接解方

不需要文件說明「這頁你進不進得去」，鎖頭圖示本身就是視覺提示，減少 moderator 花時間點進去
才發現 404 的挫折（呼應 §3.2 的角色動態隱藏設計，鎖頭是「即使看得到入口也知道多半進不去」
的補充提示，用在 §5.4 三個路由對 moderator 仍可見的部分，例如 `/admin/data` 對 moderator
是可見但唯讀）。

---

## 8. 手機版轉換檢查清單

沿用 §1.5 的漢堡＋抽屜模式（§3.2 已規格化為 `AdminShell` 的一部分）。逐路由確認：

| 路由 | 現況手機版風險 | 處理方式 |
|---|---|---|
| `/admin`（值班中心） | 3 張卡片 `sm:grid-cols-3` 手機上已自動收成單欄，OK；新增的分類分佈磚需確認 `grid-cols` 同樣有手機斷點 | 分類分佈磚比照現有 `grid gap-4 sm:grid-cols-3` 寫法，預設單欄 |
| `/admin/reports` | 雙欄「列表+處理面板」加強版（§5.2.1）在窄螢幕必須退回單欄 | `<880px` 用 CSS 斷點強制單欄，處理面板不 `sticky`（比照定案版 `.process-panel { position: static }` 規則），沿用既有的同頁展開模式 |
| `/admin/appeals` | 現有卡片式展開已對手機友善 | 核准的確認彈窗（§5.2.2）需確認 `.modal` 在手機寬度下 `max-width:460px` + `padding:20px` 邊界，小螢幕仍可正常顯示（定案版已驗證過這個尺寸） |
| `/admin/items` | 強制下架二段式確認彈窗在手機上需要能正常輸入＋鍵盤不擋住確認按鈕 | 沿用定案版 `.modal-backdrop { padding:20px }` 置中彈窗樣式，並確認 `input` focus 時手機虛擬鍵盤彈出不會把「確認下架」按鈕擠出畫面外（必要時彈窗改用 `max-height` + 內部捲動） |
| `/admin/users` | 建立限制表單欄位多（type/reason/expiresAt），手機上直向排列已經是預設（無 `sm:grid-cols`），OK | 確認 `full_block` 二段式確認彈窗同上處理 |
| `/admin/support-tickets` | 兩排篩選 tab（狀態+認領）在窄螢幕會換行，`flex-wrap` 已處理 | 維持現況 |
| `/admin/audit-logs` | 篩選表單 `flex flex-wrap gap-2`，`<select>` + `<input>` 在窄螢幕會換行，OK；`detail` 原始 JSON 用 `overflow-x-auto`（`audit-logs/page.tsx:152`）已處理長字串溢出 | 維持現況，新增的 `ACTION_LABEL` 只是換文字不影響版面 |
| `/admin/growth` | 卡片 `sm:grid-cols-2`，手機單欄 OK | 維持現況 |
| `/admin/ops` 系列 | 圖表元件（`bar-chart.tsx`/`line-chart.tsx`）需確認 SVG 有 `viewBox` + `max-width:100%`（dataviz 技能要求），現有實作已遵循 | 併入 `AdminShell` 後確認 `OpsNav` 的分頁 pill 列在窄螢幕正常換行 |
| `/admin/data` | 兩個表格（政策清單／清除紀錄）都用 `overflow-x-auto` + `min-w-[640px]`（`data/page.tsx:55,100`）——手機上會是橫向捲動表格 | **維持現況**（表格型資料在手機上橫向捲動是可接受的既定模式，比硬擠成卡片式更不容易資訊遺漏，且此頁使用頻率低，不需要為了手機優化投入額外重新設計） |
| `/admin/legal-holds`、`/admin/legal-requests`、`[id]` | 卡片式清單，`max-w-3xl`/`max-w-2xl` 容器，手機上已是單欄 | 新增的確認彈窗與戳章步道需確認：戳章步道 `.stamp-track` 在極窄螢幕（`<375px`）需要橫向捲動（沿用定案版 `.stamp-track-scroll { overflow-x:auto }` 已內建的處理） |
| `/admin/keyword-blocklist`、`/admin/deal-sources`、`/admin/deal-reviews` | 表單 `sm:grid-cols-2` 手機單欄 OK | 維持現況 |

**緊急案件的手機可用性重點檢查**（使用者原話要求「緊急處理一則檢舉在手機上也堪用」）：
`/admin/reports` 的處理面板必須確認——textarea 輸入處理備註、選擇下一個狀態、按送出——這
一組操作在手機直向、虛擬鍵盤彈出時，送出按鈕仍在可視範圍內或至少捲動可及，不能被鍵盤完全
遮住。這是本規格認定的**手機版驗收紅線**，其餘頁面若手機版體驗不完美但不影響核心「緊急處理
一則檢舉」的能力，可接受列為後續加強項目。

---

## 9. 與前台共用的元件對照表

假設前台規格會定義以下元件／模式，後台直接沿用，不重新定義：

| 後台使用情境 | 沿用前台哪個元件/模式 | 差異 |
|---|---|---|
| 案件狀態徽章（`StampBadge`，§4.2） | 前台物品詳情頁的交接進度戳章底層樣式（`.stamp` 系列 CSS） | 後台多數用「單章」而非「track」（例外見 §4.3），且新增 inline 22-24px 縮小尺寸供清單使用（前台目前只在 54px 展示） |
| 值班中心熱點磚（§3.3） | 前台首頁「找好物地圖」的 `.hotspot`/`.heat-badge` 元件 | 後台的「地點」維度改成「檢舉分類」，數字量級門檻可能需要依實際流量微調（前台是物品件數，後台是檢舉件數，量級尺度不同） |
| 強制下架兩段式確認（§5.2.4） | 前台定案版本身就是「強制下架」情境，直接照抄，不是借用 | 唯一差異是覆誦文字對照物品標題（跟前台一致） |
| 危險操作二次確認 modal（§5.4.2、§5.4.3） | 前台的 `.modal-backdrop`/`.modal` 結構與 `.irreversible-note` | 部分操作（解除保全）不需要覆誦文字，只用雙按鈕確認，是同一個 modal 元件的「輕量模式」 |
| 手機漢堡＋抽屜（§3.2、§8） | 前台頂部導覽的 `.hamburger-btn`/`.nav-drawer` 完整 CSS/JS 行為 | 後台抽屜內容是 4 個功能分組而非「前台/後台」兩個 navgroup，互動邏輯（aria-expanded、Escape、點外部關閉、焦點管理）完全相同 |
| 淺色/深色主題切換 | 前台既有 `src/components/theme-provider.tsx`/`theme-toggle.tsx`（M11 已改成 class strategy，預設淺色） | 後台沿用同一套 `ThemeProvider`，不需要獨立的後台主題狀態 |
| 新手導覽 coachmark（§7.1） | 前台 `src/components/onboarding-tour.tsx` 的實作模式（非真實 DOM spotlight，置中卡片式） | 獨立的 `localStorage` key（`admin_tour_done`）與獨立步驟內容，UI 結構複製一份而非參數化共用（避免前後台步驟內容耦合在同一元件，未來各自修改互不影響） |

---

## 10. 實作備註與待前台規格確認事項

1. **Token 遷移時機**：本文件全篇引用定案版預覽的 token 名稱（`--brand`、`--ink` 等），與
   目前 `src/app/globals.css` 的 `--color-*` 命名不同（見 §1.1）。後台開發不應該先於前台
   做 token 遷移，兩者需要同一個 PR 或緊接的 PR 完成，避免後台先套用一套前台還沒定案的
   變數名稱造成之後要改兩次。
2. **`AdminShell` 需要 `db.report.groupBy` 等新查詢**：§3.3 值班中心的分類分佈磚、§6.2 的
   稽核紀錄捷徑連結都需要少量新查詢邏輯，但都是既有資料表的 `groupBy`/query param，不需要
   新 migration。
3. **`ACTION_LABEL` 完整清單需要額外 grep**：§5.5.1 提到的稽核紀錄白話對照表，實際完整的
   action 代碼清單需要另外 grep 全專案 `writeAudit(` 呼叫點統整（本次規格撰寫過程只讀了
   page.tsx 沒有逐一讀過所有 API route，無法保證列出的幾個代號涵蓋全部，實作時需要補齊）。
4. **API 層級錯誤訊息在地化**（§7.3）：不在本文件範圍，需要另外盤點所有 `/api/**` route
   的 error message 是否可能夾雜非中文技術字串直接透出給前端顯示。
5. **訴訟保全建立表單的「貼網址自動解析」改善**（§5.4.2）：判斷為中期加強項，非本次必做，
   先落檔待後續排入。
6. **法務文案審閱**：`/admin/data`、`/admin/legal-holds`、`/admin/legal-requests` 三頁任何
   白話化後的新文案，比照 CLAUDE.md 既有慣例（M7 法務相關文案標註「需律師審閱」），本規格
   的白話化文案草稿一樣需要在真正上線前過一次法務/律師確認，不能因為「寫得比較好懂」就跳過
   既有的審閱門檻。
7. **`AdminShell` 的角色隱藏邏輯 vs 各頁 `notFound()` 檢查會不會重複判斷兩次**：這是刻意
   的設計（§3.2 已說明理由），效能上多一次 `db.user.findUnique` 查詢（layout 一次、頁面
   一次），若未來效能有壓力可以考慮把角色資訊透過 React context 從 layout 往下傳，但目前
   `/admin/*` 流量低，不建議為了省一次查詢增加架構複雜度。
