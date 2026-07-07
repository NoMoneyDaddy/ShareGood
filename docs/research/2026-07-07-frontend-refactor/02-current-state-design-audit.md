# 前端現況設計盤點：問題診斷（2026-07-07）

> 目的：為即將開工的前端重構提供「現況清單＋設計問題診斷」，讓後續設計規格有明確的靶。
> 範圍：只讀盤點＋實跑截圖，**未修改任何程式碼**。
> 讀者對象：接下來要寫設計規格／執行重構的 session。

## 0. 一句話結論

首頁與 /items 列表頁已經有一輪認真的設計投入（暖白＋琥珀橘＋近黑墨字的品牌調色盤，
含手動校正過的 WCAG AA 對比度），視覺完成度不差；但**除了這兩頁以外，其餘約 30 個路由中
有 18 個完全沒有套用全站導覽殼層**（無 SiteHeader、無 BottomTab、部分連 SiteFooter 都沒有），
導致「逛好物」與「首頁」之外的每一步操作（上架、對話、通知、優惠券錢包……）看起來像是脫離
產品的孤兒頁面。這不是「還沒設計」的問題，是「有設計系統但沒有共用 layout 強制套用」的
結構性問題，本次重構的第一個優先級應該是把三個共用元件收進一個路由群組 layout，而不是
重新設計視覺語言。

## 1. 技術棧與資產盤點

| 項目 | 現況 |
|---|---|
| 框架 | Next.js 16.2.10（App Router），React 19.2.4 |
| CSS | Tailwind CSS v4（CSS-first 設定，無 `tailwind.config.js`，設定寫在 `postcss.config.mjs` 與 `src/app/globals.css` 的 `@theme` 區塊） |
| 元件庫 | shadcn/ui（`components.json` style=`radix-nova`，baseColor=`neutral`），底層用 `radix-ui` 套件。已安裝元件僅 10 個：`avatar/badge/button/card/dialog/dropdown-menu/input/label/select/sonner/textarea`（`src/components/ui/`）——**沒有** `dialog` 以外的 overlay（如 `sheet`/`drawer`）、沒有 `tabs`、沒有 `skeleton`、沒有 `table`，這些目前都是各頁面手刻 |
| 共用元件 | `src/components/`：`site-header.tsx`、`bottom-tab.tsx`、`site-footer.tsx`、`report-button.tsx`、`legal-draft-notice.tsx`（**只有 5 個，且如下述沒有被統一組裝進 layout**） |
| Design tokens | **有**，在 `src/app/globals.css`：shadcn 預設的中性色 token（`--background/--foreground/--primary`…）之上，額外疊加一組品牌 token（`--color-paper/--color-paper-2/--color-ink/--color-ink-soft/--color-ink-disabled/--color-line/--color-brand/--color-brand-ink/--color-brand-soft/--color-navy`），並有詳細中文註解記錄對比度校正過程（`--color-brand` 註解：白字對比 4.99:1，符合 WCAG AA）。另有 `.stitch/DESIGN.md`（26KB，`ui-ux-pro-max` 產出）記錄了首頁那次設計的完整 spec（色票／字級／間距／圓角比例） |
| 字型 | `Geist Sans`（body，`--font-sans`）／`Geist Mono`／`Manrope`（`--font-display`，僅 wordmark 使用，600-800 weight）。中文 fallback 鏈完整：`"PingFang TC", "Noto Sans TC", "Microsoft JhengHei"` |
| 深色模式 | **有 token 定義**（`.dark` class 選擇器完整定義一套 shadcn 中性色），已安裝 `next-themes`，但**沒有任何 UI 讓使用者切換**（找不到 theme toggle 元件），品牌 token（paper/ink/brand 等）也**只在 `:root` 定義、沒有 `.dark` 覆寫**——若真的觸發 `.dark` class，畫面會變成 shadcn 中性灰階但 `bg-paper text-ink` 仍是亮色 token，等於半套深色模式，會壞版 |
| 動畫 | `tw-animate-css`，且已手動補上 `prefers-reduced-motion` 覆寫（`globals.css:138-147`，將 Radix 元件 `data-state=open/closed` 動畫收斂成近乎瞬時）——這塊做得比一般专案仔細 |
| Icon | `lucide-react` |
| 響應式斷點策略 | 沿用 Tailwind 預設斷點，主要用 `sm:`/`md:`，容器統一 `max-w-6xl`（1152px）或 `max-w-3xl`/`max-w-lg`（表單類窄頁） |

## 2. 頁面清單與分級

App Router 下共 **41 個 `page.tsx`**（不含 API route）。分級如下：

### P0（首頁動線核心）

| 路由 | 檔案 | SiteHeader | BottomTab | SiteFooter |
|---|---|---|---|---|
| `/` 首頁 | `src/app/page.tsx` | ✅ | ✅ | ✅ |
| `/items` 逛好物列表 | `src/app/items/page.tsx` | ✅ | ✅ | ✅ |
| `/items/[id]` 物品詳情 | `src/app/items/[id]/page.tsx` | ✅ | **❌** | ✅ |
| `/items/new` 上架表單 | `src/app/items/new/page.tsx` | **❌** | **❌** | **❌** |
| `/deal-infos`、`/deal-infos/[id]`、`/deal-infos/new` 好康資訊 | `src/app/deal-infos/**` | 列表＋詳情 ✅／`new` **❌** | **❌**（三頁皆無） | 列表＋詳情 ✅／`new` **❌** |

### P1（次要但常用）

`/conversations`、`/conversations/[id]`、`/notifications`、`/me/wallet`、
`/me/settings`、`/me/notification-preferences`、`/me/subscriptions`、`/u/[userId]`、
`/support`、`/support/[id]`、`/guide`、`/rules`、`/privacy`、`/terms`、`/onboarding`

—— 其中 `/u/[userId]`、`/guide`、`/rules`、`/privacy`、`/terms` 有 SiteHeader/SiteFooter；
**其餘全部（對話列表、對話詳情、通知、錢包、設定、通知偏好、訂閱、支援工單、
onboarding）完全沒有任何全站導覽殼層**，BottomTab 則一個都沒有。

### P2（後台與法務）

`/admin/*`（17 個子頁，自己的 `AdminNav`，獨立殼層，合理）、`/onboarding`（見上，缺殼層）。

**關鍵結構性發現**：全站 41 個 page.tsx 裡，**只有 `/` 和 `/items` 兩頁**同時擁有
SiteHeader＋BottomTab＋SiteFooter 三件套；沒有任何 `layout.tsx`（除了根 `src/app/layout.tsx`
只包 `<html><body>`）把這三個元件收斂成共用殼層——每個 page.tsx 各自手動 import 三個元件，
於是新頁面很容易「忘記」，而目前確實有 18+ 頁忘記了。這是全部路由分級表中最值得寫進重構
規格第一條的事實。

## 3. 逐頁設計診斷

### P0 詳細診斷

#### `/`（首頁）—— `src/app/page.tsx`

**截圖**：`screenshots/home-desktop.png`、`home-mobile.png`、`home-mobile-viewport-fold.png`

做得好的地方：
- 色彩策略乾淨：暖白 `paper` 底、近黑 `ink` 文字、單一飽和色 `brand`（琥珀橘）只用在
  CTA／免費標籤／進行中狀態，符合 PRODUCT.md 定的「單一品牌色克制使用」原則，也避開了
  impeccable 檢查清單裡的「紫色泛用色」「暖米色高端消費品套路」兩個常見 AI 套路。
- Hero 用 split 版面（左文案＋搜尋框、右 2×2 拼貼），沒有落入「大數字＋漸層＋統計」
  的 SaaS 樣板（hero-metric template）。
- 三步驟說明區塊、信任列（絕不收費／私訊才開放／分享者做主）刻意用不同版面（三步驟用
  卡片＋數字圓框、信任列用橫向 divide 清單），避免「同一張卡片模板重複三次」的單調感——
  這正是 impeccable 檢查清單明確點名的「identical card grids」反面案例，這裡做對了。
- 圖片載入失敗／無圖時的 fallback（`bg-paper-2` 空格）有處理，不會露白洞或壞版。
- `motion-reduce:` 變體有跟著 hover scale 動畫一起補（`page.tsx:146`），跟 globals.css
  的全域 reduced-motion 覆寫呼應。

問題：
- **手機版第一屏搜尋 CTA 之外全被 2×2 拼貼圖擠掉**（`md:block` 隱藏拼貼是對的決策，見
  `page.tsx:88-91` 註解已說明原因，這條是刻意的、不是缺陷）。
- `home-mobile.png`（fullPage 截圖）與 `home-mobile-viewport-fold.png`（只截第一屏）
  對比後確認：BottomTab 是 `position:fixed`，fullPage 截圖會把它疊印在滾動中段——**這是
  screenshot 工具的已知副作用，不是頁面本身的 bug**，之後看 fullPage 截圖時要扣掉這個
  視覺假象。
- 首頁本地資料庫目前的「熱門好物」全部是 E2E 測試殘留資料（標題前綴 `[wallet-test]`、
  全部無圖），不是設計問題但會讓截圖看起來比實際上線後單調（見「已知限制」）。
- 首頁的 hero 拼貼、分類捷徑 pill、商品卡三處都用了 `rounded-xl`/`rounded-2xl` +
  `border-line` + `bg-card`，视覺上稍微單一，但因為版面本身有變化（見上一條「做得好」），
  尚不到需要重做的程度。

#### `/items`（逛好物列表）—— `src/app/items/page.tsx`

**截圖**：`screenshots/items-list-desktop.png`、`items-list-mobile.png`、
`items-list-mobile-viewport-fold.png`

做得好：色彩／字級／卡片樣式與首頁完全一致（同一套 token），排序 pill 的
active/inactive 狀態對比清楚（`aria-current` 也正確標註），空狀態文案友善且給出下一步
行動（分享物品的連結）。

問題：
- **手機版篩選列擁擠、搜尋框內容被壓縮到只剩 3 個字**：`items-list-mobile-viewport-fold.png`
  可見「搜尋好」被切斷——`items/page.tsx:89-132` 的 form 用 `flex flex-wrap gap-2` 把
  「文字輸入框＋兩個 `<select>`＋送出按鈕」塞在同一行，390px 寬度下 `flex-1` 的輸入框
  被兩個原生 `<select>` 擠到只剩極窄寬度，可用性差（觸控目標也可能小於 44px 高度沒問題
  但寬度過窄影響可辨識性）。桌面版（`items-list-desktop.png`）同一版面沒有這個問題。
  這是本次重構值得處理的具體項目：手機版篩選列需要換成堆疊或抽屜（可惜元件庫目前沒有
  `sheet`/`drawer`，需要另外安裝）。
- 原生 `<select>` 元件（`items/page.tsx:98-123`）樣式與 shadcn 的 `Select`（`src/components/
  ui/select.tsx`，Radix 版本）不一致——這頁刻意用原生 `<select>`（表單用 GET method 慣例），
  但視覺上跟其他頁面用到的 Radix Select 長得不一樣（原生下拉箭頭 vs. 客製箭頭），是一個
  「同一產品裡兩種下拉選單長相」的一致性小問題。
- 商品卡片本身跟首頁重複（同一套 `rounded-xl border-line bg-card` + 圖片 + 免費標籤 +
  縣市 + 標題 + 分類標籤），這是合理的重用，不是缺陷。

#### `/items/[id]`（物品詳情）—— `src/app/items/[id]/page.tsx`

**截圖**：`screenshots/item-detail-desktop.png`、`item-detail-mobile.png`

做得好：主圖＋縮圖列處理正常，分享者資訊列＋檢舉按鈕的層級清楚，留言表單與空狀態
（「還沒有留言，當第一個留言的人吧」）語氣延續首頁「鄰居互助」調性。

問題：
- **全站唯一在 P0 動線裡缺 BottomTab 的頁面**：使用者從首頁或列表頁點進物品詳情後，
  底部導覽消失，只能靠瀏覽器返回鍵回到列表——違反 PRODUCT.md 明講的「底部導覽是整個
  產品的骨架」原則。物品詳情是使用者停留最久、最可能想要「返回逛好物」或「切去訊息」
  的頁面之一，缺 BottomTab 影響不小。
- **潛在的「卡片牆」風險**：`page.tsx` 依序渲染 `CouponSection`／`CouponUsageSection`／
  `TicketSection`／`PointSection`／`DirectShareSection`／`ClaimsSection`／`LotterySection`／
  `HandoverSection`／`ThanksSection` 最多 9 個子區塊，其中至少 6 個（`coupon-section.tsx`
  `direct-share-section.tsx`×2／`lottery-section.tsx`／`point-section.tsx`／
  `thanks-section.tsx`／`ticket-section.tsx`）各自用近乎相同的
  `rounded-xl/2xl border-line bg-card p-4/p-5` 外框——這是每個里程碑各自新增一個功能模組、
  沒有回頭做整頁視覺層級設計的典型結果。目前截圖的測試物品（優惠券、無抽籤無交接）只
  觸發 2-3 個區塊、視覺上還算乾淨（見 `item-detail-mobile.png`），但一個同時「有優惠券
  ＋正在抽籤＋正在交接」的真實物品會疊出 5+ 個外觀雷同的卡片方塊，層級會塌平——這是
  impeccable 檢查清單「nested cards are always wrong」「identical card grids」的典型案例，
  重構時應該把「物品狀態時間軸」（留言中→已認領→交接中→已完成）統一成一個狀態感知的
  單一時間軸元件，而不是 9 個獨立 section 各自判斷要不要出現。
- 各 section 檔案分散（10 個檔案）但沒有共用的「區塊標題／區塊外框」元件，樣式靠複製貼上
  維持一致，未來改一次要动 6+ 個檔案。

#### `/items/new`（上架表單）—— `src/app/items/new/page.tsx`

**截圖**：`screenshots/items-new-desktop.png`、`items-new-mobile.png`

問題（本頁是本次盤點裡問題最集中的一頁）：
- **完全沒有 SiteHeader／BottomTab／SiteFooter**——`page.tsx` 只回傳一個裸的 `<main>`，
  使用者從 BottomTab 中央的「分享」大按鈕點進來後，畫面上沒有任何品牌識別、沒有返回
  首頁的連結、沒有登出按鈕，只有一個表單孤零零地浮在 `bg-paper` 背景上（見截圖）。
  這是全站導覽缺失問題裡影響最大的一個實例，因為「分享」是 PRODUCT.md 定義的核心
  操作、也是 BottomTab 視覺上最強調的按鈕（發光陰影＋放大圖示），落地頁卻是導覽真空。
- 表單本身（標題／分享的話／分類／縣市／圖片上傳／發布按鈕）版面乾淨、觸控目標
  （`size="xl"` 44px 高）合格，`disabled:opacity-50` 是 shadcn 預設行為、非設計缺陷。
- 手機與桌面版面幾乎一樣（表單本來就是單欄），沒有额外的響應式問題。

#### `/deal-infos`（好康資訊列表）

**截圖**：`screenshots/deal-infos-desktop.png`、`deal-infos-mobile.png`

有 SiteHeader／SiteFooter，缺 BottomTab（全站只有 `/` 與 `/items` 有）。本地資料庫
`deal_infos` 目前 0 筆，空狀態文案「目前沒有符合條件的好康資訊」清楚但整頁只有一個
篩選列＋一個空狀態卡片，桌面版下方留白極大（`deal-infos-desktop.png` 可見內容只佔
版面上方 1/3），視覺上偏空洞，這裡到底該用大留白的空狀態插圖，還是把頁面壓縮成
更緊湊的版面，值得在重構規格裡明確決定（目前是「功能做完但沒有為『0 筆資料』
情境特別設計」的典型樣子）。`deal-infos/new`（投稿好康）與 `/items/new` 一樣完全缺
導覽殼層，未截圖但已用 grep 確認（`src/app/deal-infos/new/page.tsx` 不在
SiteHeader/BottomTab 清單裡）。

### P1 概要診斷

- **`/conversations`、`/notifications`、`/me/wallet`（已截圖）**：三頁呈現一致的模式——
  只有 `<h1>` 標題＋一段說明文字＋空狀態，**完全沒有 SiteHeader／BottomTab／SiteFooter**，
  頁面內容左上角孤立地浮在大片留白的暖白背景上（`conversations-desktop.png`、
  `notifications-desktop.png`、`me-wallet-desktop.png` 三張截圖幾乎是同一個畫面，只是
  文字不同）。使用者從首頁鈴鐺圖示點進 `/notifications` 後，連「好物共享」品牌 logo
  都看不到，等於暫時「離開」了產品。這批頁面之後若有實際資料（對話列表、通知列表、
  優惠券），版面設計本身（清單項目樣式）還沒被實跑檢視過，需要之後補上有資料狀態的
  截圖驗證。
- **`/me/settings`、`/me/notification-preferences`、`/me/subscriptions`**：程式碼結構
  與 `/me/wallet` 相同（無殼層），推測視覺呈現一致，未逐一截圖。
- **`/u/[userId]`、`/guide`、`/rules`、`/privacy`、`/terms`**：有 SiteHeader／SiteFooter，
  屬於少數「記得套殼層」的 P1 頁面，法務類頁面內容以純文字為主，優先度低。
- **`/support`、`/support/[id]`**：無殼層（同上模式）。
- **`/onboarding`**：無殼層——這頁其實是新使用者第一次使用產品的關鍵時刻（設定暱稱／
  縣市），落地即無導覽的问题在這裡格外可惜。

### P2 一句話診斷

`/admin/*`（17 頁）：有自己的 `AdminNav` 殼層，功能導向、資訊密度高、視覺一致但明顯是
「工具感」而非「產品感」，與 PRODUCT.md「不要走冷淡的 SaaS 工具感」的原則有意識地
區隔（後台本來就不需要遵守前台品牌調性），本次重構範圍應排除或最後處理。

## 4. 重構範圍建議

| 頁面/範圍 | 建議 | 理由 |
|---|---|---|
| **全站導覽殼層**（SiteHeader/BottomTab/SiteFooter） | **最優先重做，方式是架構重構而非視覺重做**：抽成 `src/app/(main)/layout.tsx` 之類的路由群組共用 layout，一次性把 18+ 個缺殼層的頁面接上，不需要重新設計三個元件本身的視覺 | 視覺 token／樣式已經是對的，缺的是「強制套用」的機制；這是投資報酬率最高的一步 |
| `/` 首頁 | 套新 tokens 即可，不需要重做 | 已有完整設計投入且執行到位 |
| `/items` 列表 | 套用殼層修正後，額外修手機版篩選列（換成堆疊或 drawer） | 視覺語言已對，僅手機版一處佈局問題 |
| `/items/[id]` 詳情 | 除了補 BottomTab，建議**重新設計「物品狀態區塊」的資訊架構**：把 9 個獨立 section 整併成一個依狀態切換的單一時間軸/卡片，而不是逐一疊加 | 目前是功能疊加的產物，尚未做過整頁層級設計，重構價值最高 |
| `/items/new` 上架表單 | 補殼層後重新檢視版面即可，表單本身邏輯與觸控目標已合格 | 問題主要是導覽缺失，不是表單設計本身 |
| `/deal-infos` 系列 | 補殼層＋BottomTab，並針對「0 筆資料」空狀態重新設計留白比例 | 空狀態文案已有但版面比例待調 |
| `/conversations`、`/notifications`、`/me/*`、`/support`、`/onboarding` | 補殼層後，需要用有資料的帳號重新截圖驗證清單/表單樣式（本次盤點只看到空狀態） | 目前唯一能確認的問題是導覽缺失，清單樣式細節待補測 |
| `/admin/*`、法務頁（`/rules`/`/privacy`/`/terms`） | 排除在本次重構範圍外，或最後處理 | 後台工具感是刻意選擇，法務頁優先度低 |
| 深色模式 | 決定要不要真的做：若要做，品牌 token（paper/ink/brand 等）需要補 `.dark` 覆寫；若不做，建議移除 `next-themes` 依賴或至少不要留半套 token 造成未來誤用 | 目前是「看起來有但沒接完」的狀態，兩種決定都比維持現狀好 |

## 5. 已知限制

1. **本機無 MinIO**：`.env` 的 `S3_ENDPOINT=http://localhost:9200` 對應服務未啟動，且
   環境內找不到可執行的 MinIO 二進位檔（`/tmp/minio` 是無效的 stub，非真實執行檔）。
   所有截圖裡的商品圖都是「無圖片」佔位框，無法評估真實照片情境下的卡片視覺表現，
   這與 CLAUDE.md 過去多個 milestone 記錄的已知限制一致。
2. **本地資料庫內容是 E2E 測試殘留資料**：`items` 表現存 26 筆 `published` 資料清一色
   是 `[wallet-test]` 前綴的優惠券測試 fixture（`prisma/seed.ts` 本身只灌縣市/分類/
   關鍵字黑名單等參考資料，不建立示範物品），`deal_infos` 為 0 筆。這讓首頁「熱門好物」
   與 `/items` 列表的截圖不能反映真實上線後的視覺密度與圖片情境，僅能用來檢視版面
   結構本身。
3. **P1 頁面截圖僅涵蓋空狀態**：`/conversations`、`/notifications`、`/me/wallet` 截圖
   時對應測試帳號沒有任何對話/通知/優惠券資料，只能確認「殼層缺失」與「空狀態文案」，
   無法評估這些頁面在有真實列表資料時的排版品質（例如通知列表項目的間距、對話列表的
   未讀狀態視覺）。若之後要對這幾頁做設計規格，建議先用資料填充後再截一輪圖。
4. **截圖環境細節**：Playwright `fullPage: true` 截圖會把 `position: fixed` 的
   BottomTab 疊印在滾動中段（見 `home-mobile.png` vs `home-mobile-viewport-fold.png`
   的對照），已在文中註明哪些是截圖假象、哪些是真實版面問題；另外畫面左下角的黑色圓形
   「N」圖示是 Next.js dev mode 專用的開發指示器，正式環境不會出現。
5. **`/items/new`、`/conversations` 等需登入頁面**：用 `e2e/support/auth.ts` 現成的
   「直接在 `sessions` 資料表插入測試 session」方式建立臨時測試帳號取得截圖，截圖後已
   執行 `cleanupTestData` 清除該帳號與其資料，資料庫未留下本次盤點產生的殘留資料。
6. 本次盤點未逐一截圖 `/me/settings`、`/me/notification-preferences`、
   `/me/subscriptions`、`/support`、`/support/[id]`、`/u/[userId]`、`/guide`、`/rules`、
   `/privacy`、`/terms`、`/onboarding`——僅用程式碼層級（grep SiteHeader/BottomTab 使用
   狀況）確認殼層有無，未做逐頁視覺診斷，因其優先度為 P1/P2 且模式與已截圖頁面高度
   相似（同一個「無殼層」缺陷）。
