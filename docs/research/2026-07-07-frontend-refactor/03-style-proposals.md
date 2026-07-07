# ShareGood 全站視覺識別提案（三選一）

日期：2026-07-07
方法：依 `ui-ux-pro-max`（色彩/字型/風格方法論）與 `emil-design-eng`（打磨/圓角/陰影/動效個性）
兩套技能產出；對比值全部用標準 WCAG 相對亮度公式手算（腳本見本次工作紀錄，非目測估計）。
三套皆**不是**現有的暖白＋琥珀橘、也**不含**紫藍漸層，彼此色相互斥、可並排辨識。
對應實跑渲染見 `style-proposals.html`，截圖見 `screenshots/proposal-*.png`。

品牌個性關鍵詞（三套皆須對照）：**溫暖、可信任、鄰里感、不商業**。

---

## 共通決策（三套皆遵守）

1. **字型**：不引用外部字型檔。三套統一使用系統字型堆疊：
   `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`（沿用現有
   `--font-sans`／`--font-display` 的中文 fallback鏈，只是把英文優先字換成系統無襯線）。
   **差異化不靠替換字體家族**（嚴禁外部字檔的前提下，繁中環境沒有跨平台一致的系統襯線可靠選項），
   而是靠標題字重／字距／字級節奏三個維度做出三套截然不同的排版性格，細節見各提案「字型與節奏」小節。
2. **對比計算方法**：sRGB 相對亮度公式（WCAG 2.x 標準公式），(L1+0.05)/(L2+0.05)，
   L 大者除以 L 小者。所有「文字/背景」組合皆 ≥4.5:1；大字（≥24px 或 ≥19px 粗體，例如標題、
   按鈕大字）允許 ≥3:1 但本提案三套實際上絕大多數欄位仍達 4.5:1 以上，只有分隔線（裝飾性、
   非文字）刻意維持低對比（約 1.3–1.9:1，比照現有 `--color-line` 的柔和分隔線慣例）。
3. **語意色**：現有 `globals.css` 只有 shadcn 的 `--destructive`，**沒有** success/warning 語意色，
   也**沒有**獨立的「輔助色」token（只有 brand 系列）。三套提案都新增以下欄位，實作時對應
   新增 token：`--color-accent`／`--color-accent-ink`（輔助色的一般版與深字版）、
   `--color-success`／`--color-warning`／`--color-danger`（語意色）。

---

## 提案 A：苔綠與奶白（Moss & Cream）—— 社區菜園感

### 設計哲學
> 像鄰里菜園一樣，把不需要的種回土裡，讓新的需要在此發芽。

**對照品牌個性**：綠色是最直覺的「共享／永續／扎根土地」聯想，奶白底避開任何精品感或科技冷感；
低飽和度的苔綠比鮮綠更沉穩，符合「不商業」——這不是環保品牌行銷色，是最樸素的植物色。

### Token 表（Light）

| Token | Hex | 用途 | 對比組合 | 比值 |
|---|---|---|---|---|
| `paper` | `#F6F4EC` | 頁面底 | — | — |
| `paper-2` | `#ECE7D8` | 次要底（分類列/頁尾） | — | — |
| `ink` | `#232821` | 主文字 | ink / paper | **13.65:1** |
| `ink-soft` | `#5A6152` | 次文字 | ink-soft / paper | **5.84:1** |
| `ink-disabled` | `#68705F` | 停用/未開放說明文字 | ink-disabled / paper | **4.68:1** |
| `line` | `#CBC1A6` | 分隔線（裝飾性，非文字） | line / paper | 1.63:1（刻意柔和） |
| `brand` | `#3D6B45` | 品牌主色（按鈕底/圖示） | 白字 / brand | **6.20:1** |
| `brand` 作文字 | `#3D6B45` | 連結/強調文字 | brand / paper | **5.63:1** |
| `brand-ink` | `#2A4A30` | hover/pressed 深字版 | 白字 / brand-ink | **9.90:1** |
| `brand-ink` 作文字 | `#2A4A30` | 深色強調文字 | brand-ink / paper | **8.99:1** |
| `brand-soft` | `#DCEBD7` | 徽章淺底 | ink / brand-soft | **12.10:1** |
| `accent`（赤陶，輔助色） | `#8F5228` | 次要強調（例如：分類標籤第二色） | accent / paper | **5.60:1** |
| `accent` | 同上 | | 白字 / accent | **6.17:1** |
| `neutral-deep`（對應現有 navy） | `#26362A` | 頁首/頁尾深色帶 | 白字 / neutral-deep | **12.78:1** |
| `success` | `#2F7D4F` | 成功語意 | success / paper | 4.58:1 |
| `success` | 同上 | | 白字 / success | 5.04:1 |
| `warning` | `#8A5A12` | 警告語意 | warning / paper | 5.37:1 |
| `warning` | 同上 | | 白字 / warning | 5.91:1 |
| `danger` | `#A83B32` | 危險語意 | danger / paper | 5.72:1 |
| `danger` | 同上 | | 白字 / danger | 6.29:1 |

### Token 表（Dark）

| Token | Hex | 對比組合 | 比值 |
|---|---|---|---|
| `paper` | `#14170F` | — | — |
| `paper-2` | `#1D2117` | — | — |
| `ink` | `#ECE8DA` | ink / paper | **14.77:1** |
| `ink-soft` | `#AAB29C` | ink-soft / paper | **8.24:1** |
| `ink-disabled` | `#8B9382` | ink-disabled / paper | **5.69:1** |
| `line` | `#3E4735` | line / paper | 1.86:1（刻意柔和） |
| `brand` | `#7FB37C` | 深色字 / brand（按鈕底配深字） | **7.45:1** |
| `brand-ink` | `#59A65B` | 深色字 / brand-ink（pressed） | **6.06:1** |
| `brand-soft` | 底 `#24371F` + 字 `#8FC08A` | | **6.14:1** |
| `accent` | `#D9986A` | 深色字 / accent | **7.46:1** |
| `neutral-deep` | `#1A2116`（近 paper-2，深色模式頁首/頁尾沿用此微高一階底色即可，不需要像亮色模式那樣做出強烈深色帶） | — | — |
| `success` | `#5FBE83` | success / paper | 7.92:1 |
| `warning` | `#D9A245` | warning / paper | 7.94:1 |
| `danger` | `#E2695C` | danger / paper | 5.53:1 |

### 字型與節奏
- 標題：`font-weight: 700`，`letter-spacing: -0.01em`（略收緊，扎根感，不飄）。
- 內文：`font-weight: 400`，`line-height: 1.7`（比其他兩套更寬鬆，呼應「菜園留白呼吸」）。
- 數字（貢獻值/縣市/分類徽章）：不特別做等寬處理，維持自然比例，強調親切而非精密儀表感。

### 圓角／陰影／間距個性
- 圓角：基準 `--radius: 1rem`（16px），卡片用 `rounded-2xl`，按鈕 `rounded-xl`——渾圓但不誇張，像陶器邊緣。
- 陰影：低飽和、暖中性色調的柔和擴散陰影 `0 8px 20px -8px rgba(35,40,33,.12)`；
  主要 CTA 用品牌色發光 `0 8px 18px -6px rgba(61,107,69,.35)`（沿用現有 `--shadow-brand-glow` 命名）。
- 間距：寬鬆，區塊間距桌面 96px／手機 64px，卡片內距 20–24px——留白最多的一套，呼應「不商業、不擁擠」。

---

## 提案 B：靛青與暖沙（Indigo-Teal & Sand）—— 沉穩信任感

### 設計哲學
> 像巷口老鄰居一樣沉穩牢靠，把每一次交接都當作信用的累積。

**對照品牌個性**：靛青（刻意偏青、非紫調）是最傳統的信任色，但拉低飽和度、去掉任何漸層與光澤，
避開金融科技的冷藍調；暖沙色底提供人味而非數位感，整體節奏是三套裡最「安靜」、最少裝飾的一套，
訴求「平台在背後穩穩接住你」而非熱鬧的社群感。

### Token 表（Light）

| Token | Hex | 用途 | 對比組合 | 比值 |
|---|---|---|---|---|
| `paper` | `#F9F6EF` | 頁面底（暖沙白） | — | — |
| `paper-2` | `#F0EADD` | 次要底 | — | — |
| `ink` | `#1E2624` | 主文字 | ink / paper | **14.33:1** |
| `ink-soft` | `#57625F` | 次文字 | ink-soft / paper | **5.86:1** |
| `ink-disabled` | `#66736F` | 停用說明文字 | ink-disabled / paper | **4.58:1** |
| `line` | `#D8CDAF` | 分隔線 | line / paper | 1.47:1（刻意柔和） |
| `brand` | `#1E6B76` | 品牌主色（靛青） | 白字 / brand | **6.14:1** |
| `brand` 作文字 | 同上 | | brand / paper | **5.69:1** |
| `brand-ink` | `#164E56` | hover/pressed 深字版 | 白字 / brand-ink | **9.30:1** |
| `brand-ink` 作文字 | 同上 | | brand-ink / paper | **8.62:1** |
| `brand-soft` | `#D8EAEB` | 徽章淺底 | ink / brand-soft | **12.44:1** |
| `accent`（暖沙金，輔助色） | `#8A6A34` | 次要強調 | accent / paper | 4.64:1 |
| `accent` | 同上 | | 白字 / accent | 5.01:1 |
| `neutral-deep`（navy 對應） | `#1B2E33` | 頁首/頁尾深色帶 | 白字 / neutral-deep | **14.14:1** |
| `success` | `#3F7A3C`（刻意偏黃綠，與靛青主色區隔避免混淆） | success / paper | 4.79:1 |
| `success` | 同上 | | 白字 / success | 5.17:1 |
| `warning` | `#8A5A12` | warning / paper | 5.48:1 |
| `warning` | 同上 | | 白字 / warning | 5.91:1 |
| `danger` | `#A83B32` | danger / paper | 5.83:1 |
| `danger` | 同上 | | 白字 / danger | 6.29:1 |

### Token 表（Dark）

| Token | Hex | 對比組合 | 比值 |
|---|---|---|---|
| `paper` | `#10171A` | — | — |
| `paper-2` | `#182228` | — | — |
| `ink` | `#E9EEEC` | ink / paper | **15.44:1** |
| `ink-soft` | `#A9B7B4` | ink-soft / paper | **8.73:1** |
| `ink-disabled` | `#8A9794` | ink-disabled / paper | **5.98:1** |
| `line` | `#33454A` | line / paper | 1.80:1（刻意柔和） |
| `brand` | `#5CC0C7` | 深色字 / brand | **8.47:1** |
| `brand-ink` | `#3E9CA3` | 深色字 / brand-ink（pressed） | **5.60:1** |
| `brand-soft` | 底 `#163338` + 字 `#5CC0C7` | | **6.28:1** |
| `accent` | `#D6B478` | 深色字 / accent | **9.19:1** |
| `neutral-deep` | `#131C20`（近 paper-2 略深一階） | — | — |
| `success` | `#6FBE6A` | success / paper | 7.98:1 |
| `warning` | `#D9A245` | warning / paper | 7.94:1 |
| `danger` | `#E2695C` | danger / paper | 5.53:1 |

### 字型與節奏
- 標題：`font-weight: 600`，`letter-spacing: 0`（不收不放，最中性，像招牌字一樣沉穩）。
- 內文：`font-weight: 400`，`line-height: 1.6`（標準密度，三套裡最「整齊」的一套）。
- 三套裡**唯一**建議物品卡片的縣市/到期日等次要資訊統一靠齊、用固定寬度容器排版（不是等寬字型，
  是版面上的規矩感），強化「制度化、可信任」的視覺語言。

### 圓角／陰影／間距個性
- 圓角：基準 `--radius: 0.625rem`（10px），卡片 `rounded-lg`／`rounded-xl`，按鈕 `rounded-md`——
  三套裡最不圓潤、最「方正牢靠」的一套。
- 陰影：極低調、冷中性色調的扁平陰影 `0 4px 12px -4px rgba(30,38,36,.10)`；
  品牌色發光克制使用 `0 6px 14px -6px rgba(30,107,118,.30)`，只用在最主要的 CTA，其餘按鈕不發光。
- 間距：中等密度，區塊間距桌面 80px／手機 56px，卡片內距 20px——三套裡資訊密度最高、最「效率」的一套，
  但仍維持中低密度不做成儀表板。

---

## 提案 C：珊瑚與米白（Coral & Cream）—— 活潑親切感

### 設計哲學
> 像巷口打招呼的笑容一樣，讓分享這件事變得輕鬆又開心。

**對照品牌個性**：珊瑚色是三套裡溫度感最高的顏色，用大量留白與清楚的深色文字撐住可信度，
不因活潑而顯得輕浮；珊瑚是情感色而非精品色，特意避開金融科技慣用的藍紫調，
用來訴求「分享一件小東西也可以是件開心事」而非嚴肅的公益慈善調性。

### Token 表（Light）

| Token | Hex | 用途 | 對比組合 | 比值 |
|---|---|---|---|---|
| `paper` | `#FBF5EC` | 頁面底 | — | — |
| `paper-2` | `#F5E8DD` | 次要底 | — | — |
| `ink` | `#2B211D` | 主文字 | ink / paper | **14.48:1** |
| `ink-soft` | `#6B5A50` | 次文字 | ink-soft / paper | **6.05:1** |
| `ink-disabled` | `#7A6357` | 停用說明文字 | ink-disabled / paper | **5.17:1** |
| `line` | `#DDC7B2` | 分隔線 | line / paper | 1.50:1（刻意柔和） |
| `brand` | `#BB4531` | 品牌主色（珊瑚） | 白字 / brand | **5.24:1** |
| `brand` 作文字 | 同上 | | brand / paper | **4.83:1** |
| `brand-ink` | `#A83F31` | hover/pressed 深字版 | 白字 / brand-ink | **6.14:1** |
| `brand-ink` 作文字 | 同上 | | brand-ink / paper | **5.66:1** |
| `brand-soft` | `#FBE0D8` | 徽章淺底 | ink / brand-soft | **12.52:1** |
| `accent`（青綠，輔助色，與珊瑚互補） | `#2E6B5E` | 次要強調 | accent / paper | 5.73:1 |
| `accent` | 同上 | | 白字 / accent | 6.21:1 |
| `neutral-deep`（navy 對應） | `#2E211B` | 頁首/頁尾深色帶 | 白字 / neutral-deep | **15.56:1** |
| `success` | `#3F7D4F`（刻意與 accent 青綠區隔開） | success / paper | 4.55:1 |
| `success` | 同上 | | 白字 / success | 4.93:1 |
| `warning` | `#8A5A12` | warning / paper | 5.45:1 |
| `warning` | 同上 | | 白字 / warning | 5.91:1 |
| `danger`（刻意偏酒紅，與珊瑚主色區隔避免混淆） | `#9A2F44` | danger / paper | 6.76:1 |
| `danger` | 同上 | | 白字 / danger | 7.33:1 |

### Token 表（Dark）

| Token | Hex | 對比組合 | 比值 |
|---|---|---|---|
| `paper` | `#1B1310` | — | — |
| `paper-2` | `#241A15` | — | — |
| `ink` | `#F5EBE1` | ink / paper | **15.56:1** |
| `ink-soft` | `#C9B6A9` | ink-soft / paper | **9.37:1** |
| `ink-disabled` | `#B89E90` | ink-disabled / paper | **7.26:1** |
| `line` | `#46332A` | line / paper | 1.54:1（刻意柔和） |
| `brand` | `#F0846D` | 深色字 / brand | **7.17:1** |
| `brand-ink` | `#DD6A50` | 深色字 / brand-ink（pressed） | **5.45:1** |
| `brand-soft` | 底 `#3A2018` + 字 `#F0846D` | | **5.88:1** |
| `accent` | `#5FC7B3` | 深色字 / accent | **8.98:1** |
| `neutral-deep` | `#2A1F19`（近 paper-2 略深一階） | — | — |
| `success` | `#6BC79A` | success / paper | 8.94:1 |
| `warning` | `#D9A245` | warning / paper | 8.02:1 |
| `danger` | `#D66E86` | danger / paper | 5.61:1 |

### 字型與節奏
- 標題：`font-weight: 800`，`letter-spacing: -0.015em`（三套裡最重、最緊，最有精神的一套）。
- 內文：`font-weight: 400`，`line-height: 1.65`。
- 按鈕與徽章大量使用 `rounded-full`（膠囊形），是三套裡唯一大幅採用膠囊造型的一套，強化活潑感。

### 圓角／陰影／間距個性
- 圓角：基準 `--radius: 1.25rem`（20px），卡片 `rounded-3xl`，按鈕/徽章 `rounded-full`——三套裡最圓潤、最有彈性感的一套。
- 陰影：品牌色暖光最明顯的一套，CTA 用 `0 10px 24px -8px rgba(187,69,49,.30)`；
  一般卡片用 `0 6px 16px -6px rgba(43,33,29,.14)`。
- 間距：卡片內距刻意收緊（18–22px，比 A/B 都窄）但**區塊之間留白最大**（桌面 88px／手機 60px），
  一緊一鬆做出跳動的節奏感，而不是全面均勻留白。

---

## 三套提案 Token 命名一對一映射表

| 提案內用名 | 對應現有 `globals.css` token | 備註 |
|---|---|---|
| `paper` | `--color-paper` | 直接取代既有值 |
| `paper-2` | `--color-paper-2` | 直接取代既有值 |
| `ink` | `--color-ink` | 直接取代既有值 |
| `ink-soft` | `--color-ink-soft` | 直接取代既有值 |
| `ink-disabled` | `--color-ink-disabled` | 直接取代既有值 |
| `line` | `--color-line` | 直接取代既有值 |
| `brand` | `--color-brand` | 直接取代既有值 |
| `brand-ink` | `--color-brand-ink` | 直接取代既有值 |
| `brand-soft` | `--color-brand-soft`（**現有 globals.css 尚未定義此 token**，`.stitch/DESIGN.md` 或既有 CSS 只提到 brand/brand-ink/navy，需在實作時新增） | 新增 |
| `neutral-deep` | `--color-navy` | 直接取代既有值 |
| `accent` / `accent-ink`（深字版） | 無對應，需新增 `--color-accent`／`--color-accent-ink` | 新增 token |
| `success` / `warning` / `danger` | 無對應（現有僅 shadcn `--destructive`），需新增 `--color-success`／`--color-warning`／`--color-danger` | 新增 token |
| `--shadow-brand-glow` | `--shadow-brand-glow` | 沿用既有命名，數值依各提案品牌色重算 |
| `--font-display` / `--font-sans` | `--font-display` / `--font-sans` | 沿用既有變數名，內容改為系統字型堆疊（見「共通決策」） |

---

## 對比驗證總覽（三套最低的三組數字）

| 提案 | 最低對比組合 | 數值 | 說明 |
|---|---|---|---|
| A 苔綠 | `warning`(#8A5A12) / paper | 5.37:1 | 仍遠高於 4.5 門檻；三套中「一般文字」欄位最低值出現在 danger 系（dark: `E2695C`/paper 5.53:1） |
| B 靛青 | `accent`(#8A6A34) / paper | 4.64:1 | 三套裡最接近門檻的欄位，仍通過 AA；`ink-disabled` 亦壓在 4.58:1 |
| C 珊瑚 | `brand`(#BB4531) / paper 作文字 | 4.83:1；白字/brand 為 5.24:1 | 珊瑚主色需刻意壓深才達標，已在按鈕（白字）與純文字兩種用法都驗證 |

分隔線（`line`）在三套中皆刻意維持 1.3–1.9:1 的低對比（裝飾性、非文字內容，比照現有站上 `--color-line`
的既有慣例），不計入上表「最低對比」統計。

## 已知限制

1. 三套的「輔助色」（accent）與「語意色」（success/warning/danger）在現有 `globals.css` 完全不存在，
   選用哪一套後仍需要在實作時新增 4–5 個 CSS 變數，不是單純替換既有 token 數值。
2. 字型差異化僅能靠字重/字距/行高呈現（不得引用外部字型檔的硬限制），三套在同一支手機截圖裡
   放大看標題字重差異會比實際使用中更不明顯；若日後允許引入合法可商用的中文字型檔，
   三套的性格差異可以再放大。
3. 本文件的對比數字全部基於「純色 vs 純色」計算；若實作時在文字上疊加陰影、半透明遮罩或圖片背景，
   實際可讀對比會低於本表數字，需另外驗證。
4. 語意色（success/warning/danger）目前只設計了「文字/背景」與「白字/色塊」兩種組合，未涵蓋
   語意色配合圖示（icon）的用法，圖示對比另需驗證（一般 UI 圖示 non-text contrast 建議 ≥3:1）。
