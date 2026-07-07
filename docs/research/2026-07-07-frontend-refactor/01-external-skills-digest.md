# 前端重構外部資源精讀（第一路：GitHub agent/skill 資源）

日期：2026-07-07
方法：全程唯讀（WebFetch 抓取公開頁面 + 一次 WebSearch 交叉驗證），未 clone、未安裝、未執行任何外部程式碼。
專案背景提醒：ShareGood 是台灣縣市級免費共享平台，Next.js 16 + Tailwind v4，行動優先，受眾是一般民眾（非開發者、非設計師）。

---

## 0. 本地已載入、無需重讀的技能（一句話確認）

- **impeccable**（= pbakaus/impeccable）：本地已有，前端重構實作時直接用其 UI/UX 審查與打磨流程。
- **web-design-guidelines**（= vercel-labs/agent-skills 的 web-design-guidelines）：本地已有，直接用其 Web Interface Guidelines 檢查清單。
- **ui-ux-pro-max**（= nextlevelbuilder/ui-ux-pro-max-skill）：本地已有，直接用其風格庫/色盤/字體配對/圖表庫。
- **frontend-design**（= anthropics/skills 的 skills/frontend-design）：本地已有，直接用；且已讀 PR #210（見下方 3.C 節）了解其近期改版方向，實作時可留意 PR 提出的「可執行性」修正尚未必已合併進本地版本，需要時可手動套用其修正精神（具體、可判定的指令優先於模糊形容詞）。
- **motion-design**（= lottiefiles/motion-design-skill）：本地已有，直接用其動效時間軸/緩動/選角原則。
- **find-skills**（= vercel-labs/skills 的 skills/find-skills/SKILL.md）：本地已有，不需要另外精讀 ComposioHQ/awesome-claude-skills 或 vercel-labs/skills 本身的技能搜尋機制，本次只把這兩份當「索引清單」快速掃過（見下方）。
- **text-to-lottie**：精讀 diffusionstudio/lottie 後確認**這就是 text-to-lottie 技能的上游來源 repo**（同一套「AI 代理生成 Lottie 動畫」框架，含 Skia CanvasKit/Skottie 播放器），本地已有，等同已精讀，不需另外處理。

---

## 1. 任務分派

### msitarzewski/agency-agents
- **一句話定位**：230+ 個預先寫好人設的 AI agent 角色庫（工程/設計/行銷/業務/資安/測試/客服等八大部門），供 Claude/Copilot/Cursor 等工具直接引用。
- **可採納原則**：
  - 依功能領域分部門化任務分派，每個角色須有明確身份、核心使命、Critical Rules、可交付成果與成功指標（而非只給一句籠統指令）。
  - 複雜任務用多角色並行協作＋交付物聚合（例如「前端 → 後端 → 驗證」鏈式或並行）。
- **適用性判斷**：與 ShareGood `docs/governance/delegation-templates.md`「派工帶三件套」精神一致，可作為佐證：分派前端重構子任務時，比照其「明確可交付成果＋成功指標」的做法補強派工 prompt，但不需要引入其行銷/業務/GIS 等與本專案無關的角色。

---

## 2. 技能搜尋（索引類，僅供查表）

### ComposioHQ/awesome-claude-skills
- **一句話定位**：1000+ 生產級 Claude 技能的精選索引清單（文件處理、開發、行銷、通訊、創意媒體等十餘類）。
- **可採納原則**：作為「還有沒有本專案漏掉的技能」的查表工具；本次瀏覽未發現與 ShareGood 前端重構直接相關、且本地未覆蓋的關鍵條目（如 artifacts-builder、anydesign、Figma Automation 皆與目前純 Next.js/Tailwind 重構情境關聯低）。
- **適用性判斷**：不直接採納任何條目，僅記錄「已查過此索引，無漏網之魚」。

（vercel-labs/skills 的 find-skills 本身已在本地，見上方第 0 節。）

---

## 3. 前端設計 UI/UX

### 3.A designer-skills（julianoczkowski）
- **一句話定位**：把「設計流程」拆成 8 個可鏈式呼叫的技能（`/design-flow` 總協調、`/grill-me` 提問、`/design-brief`、`/information-architecture`、`/design-tokens`、`/brief-to-tasks`、`/frontend-design`、`/design-review`）。
- **可採納原則**：
  - 開工前先掃描既有 CSS 變數/Tailwind 配置/UI 框架主題/元件目錄，避免重複造輪子。
  - 行動優先：強制從 375px 寬度開始寫 `min-width` media query 向上擴展，而非桌面往下縮。
  - 暗黑模式與亮色模式須雙套完整支援，走 CSS 自訂屬性切換。
  - 8 種美學哲學各有具體實現參數（非模糊描述）。
  - 大任務先做資訊架構（導覽/內容層級/頁面結構/使用者流程），再拆成可獨立建構的垂直切片任務。
- **適用性判斷**：高度適用。ShareGood 前端重構前應該先做一次「既有設計系統掃描」與「資訊架構盤點」（尤其首頁 `DEMO_ITEMS` 尚未接上真的列表 API 這個已知缺口，正是資訊架構要優先釐清的地方），且行動優先＋375px 起跳與本專案受眾（一般民眾，手機為主）高度吻合。

### 3.B ui-ux-pro-max（nextlevelbuilder）— 本地已有，見第 0 節。

### 3.C taste-skill（Leonxlnx）
- **一句話定位**：用三個可調數值刻度（DESIGN_VARIANCE 設計變異度、MOTION_INTENSITY 動態強度、VISUAL_DENSITY 視覺密度）量化「品味」判斷，對抗 AI 生成的平庸感。
- **可採納原則**：
  - 用三個刻度取代「好看/不好看」的模糊爭論：一般大眾平台宜設定中低變異度（避免視覺負擔）、低到中動效強度（避免干擾操作）、中低密度（避免資訊過載）。
  - 動效/密度應對應目標受眾與使用情境，而非套用潮流。
- **適用性判斷**：概念可採納作為「重構前先定調三個刻度」的討論框架，但不需要引入其實作技能（GSAP 動畫骨架等）本身，ShareGood 已有本地 motion-design 技能可用。

### 3.D threejs-skills（CloudAI-X）
- **一句話定位**：Three.js/3D 圖形開發專精技能（場景、材質、光源、著色器、後期處理等 10 模組）。
- **適用性判斷**：**不採納**。ShareGood 是行動優先、輕量化的公益共享平台，無 3D/沉浸式展示需求，引入只會增加 bundle size 與維護負擔，與硬規則「不做花俏、聚焦核心共享迴路」的定位衝突。

### 3.E garden-skills（ConardLi）
- **一句話定位**：五個生產級技能集合，其中僅 `web-design-engineer` 跟前端重構直接相關（6 步設計工作流程＋25 種風格配方，引用 Linear/Stripe Press/Bloomberg 等設計學派，強調反通用 AI UI 模式）。
- **可採納原則**：
  - 設計系統要先聲明再動工，不要邊做邊拼湊。
  - 在關鍵步驟（腳本、主題、實現模式）設協作檢查點暫停，讓人可以介入調整方向。
  - 反套路清單（避免落入常見 AI 生成的視覺陳詞濫調）。
- **不採納部分**：`web-video-presentation`（簡報影片生成）、`gpt-image-2`（圖片生成）、`kb-retriever`（知識庫檢索）、`beautiful-article`（文章排版）四項與「前端重構」無關，不採納。

### 3.F ui-skills（ibelick）
- **一句話定位**：透過 `npx ui-skills` CLI 與 ui-skills.com 網站分類查詢 UI 設計技巧（motion 等分類），是查詢工具而非方法論檔案集。
- **適用性判斷**：**不採納安裝其 CLI**。其分類查詢概念已被本地 ui-ux-pro-max 涵蓋，且此 repo 定位偏工具/網站而非可直接萃取的規則清單，未見具體到可落檔的檢查項。

### 3.G platform-design-skills（ehmo）
- **一句話定位**：從 Apple HIG、Material Design 3、WCAG 2.2 抽取的 450+ 條平台設計規則，含 iOS/iPadOS/macOS/watchOS/visionOS/tvOS/Android/Web 八個平台模組。
- **可採納原則（Web 模組相關）**：
  - 響應式設計、無障礙（WCAG）、效能、漸進增強是 Web 平台設計的四大支柱。
  - 觸控目標尺寸、對比度等規則應直接對應 WCAG 2.2 條文編號，方便稽核。
- **適用性判斷**：ShareGood 是純 Web（無原生 App），只有 Web 模組相關，其餘七個平台模組不採納。Web 模組的 WCAG 2.2 對應可與 AccessLint（見 3.M）互補使用。

### 3.H jezweb/claude-skills
- **一句話定位**：52 項「每個都產出實質檔案/資產」的工作流技能集合，含 Frontend（tailwind-theme-builder、shadcn-ui、landing-page、react-patterns 等）、Design Assets（color-palette、favicon-gen 等）、Dev Tools 中的 design-review/ux-audit/responsiveness-check/onboarding-ux。
- **可採納原則**：
  - `responsiveness-check`：多視口響應式驗證的獨立檢查步驟值得比照，並入重構驗收清單。
  - `onboarding-ux`：新使用者體驗與空狀態（empty state）優化——ShareGood 首頁若接上真的列表 API 後，「無符合條件物品」的空狀態需要特別設計，這點直接對應本專案已知缺口。
  - `ux-audit`：獨立於功能開發之外的使用者體驗審查步驟。
- **不採納部分**：`favicon-gen`／`icon-set-generator`／`ai-image-generator`／`seo-local-business` 等一次性資產生成工具，與本次「前端重構」方法論無關，且 ShareGood 已有 MinIO 圖片管線與既有 SEO/AEO 實作（PR #11），不需要重新引入。

### 3.I Ilm-Alan/frontend-design
- **一句話定位**：非官方版的「前端設計」技能，提出 8 個「美學錨點」（Swiss、Industrial、Brutalist、Aurora Maximalism、Chaotic Maximalism、Retro-Futuristic、Organic、Lo-Fi），每個錨點鎖定具體色票/字體/紋理 token，而非模糊風格氛圍。
- **可採納原則**：先選一個美學錨點＋一個記憶點設計動作＋對應 CSS token 三件事，再開始寫程式碼，避免「先寫再想風格」。
- **適用性判斷**：概念可採納（開工前先定調美學方向），但八個錨點本身偏向強烈/實驗性風格（Brutalist、Chaotic Maximalism 等），與 ShareGood「面向一般民眾、需要親和信任感」的定位不完全吻合，若採用應選較溫和的錨點（如 Organic 或克制版 Swiss），不宜整套照搬。

### 3.J iliaal/ai-skills
- **一句話定位**：跨技能的「AI 執行紀律框架」（驗證前不能宣稱完成、規劃先行、根因分析、代碼審查兩階段），其中 Frontend Design／Tailwind CSS（v4 專門）／React Frontend 三項與前端重構直接相關。
- **可採納原則**：
  - 動工前先寫設計哲學聲明（一句話：這次要做成什麼調性）。
  - 自動掃描既有設計系統以保持一致性（呼應 3.A designer-skills）。
  - 禁止落入常見 AI 設計陳詞濫調（紫藍漸層、Space Grotesk、制式三卡英雄區）除非有意選擇。
  - **Tailwind v4 專屬**：強制 CSS-first 設定（`@theme`、`@utility` 指令）、禁止動態拼接 class 名稱字串、優先用 `gap` 而非 `space-x`、優先用 `size-*` 而非成對 `w-*`/`h-*`——**確認 ShareGood 目前 `package.json` 的 `tailwindcss` 版本正是 `^4`，此建議可直接落地**。
  - React 狀態管理按用途分工具（伺服器狀態 vs 客戶端狀態 vs URL 狀態）、App Router 邊界要清楚、Server Actions 視為公開端點需要授權檢查（這點與 ShareGood 硬規則 6「所有 mutation API 必須 server-side 權限檢查」精神完全一致）。
- **適用性判斷**：其執行紀律框架（驗證前不宣稱完成、根因分析）與本專案 `CLAUDE.md` 硬規則 3「驗證不自驗」高度重疊，屬於既有慣例的外部佐證，非新東西；Tailwind v4/React 具體建議直接可用。

### 3.K anthropics/skills PR #210（frontend-design 改版提案）
- **一句話定位**：對官方 frontend-design skill 的可執行性改版提案，核心論點是「不可執行的模糊指令」（例如「永遠不要跨代收斂到常見選擇」）在單次對話中根本無法被 Claude 驗證，應該替換成具體、可在單一 session 內判定的規則。
- **可採納原則**：
  - 設計指令要用「INSTEAD」正反配對（禁止項＋具體替代方案），不能只給禁止項。
  - 色彩指導要給具體方向詞（大膽飽和 / 內斂柔和 / 高對比極簡），不能只說「配色要好看」。
  - 排版指南要寫成可執行指令而非美學判斷句。
  - 該作者用 50 個提示、三個模型（不同能力層級）做雙盲評測，75% 勝率，證實「小模型從明確指令中受益更多」——對本專案意義是：派工 prompt 若要給執行代理（可能是較小模型）足夠明確的設計驗收標準，不能只寫「做得好看一點」。
- **適用性判斷**：這是這次調研裡對「怎麼寫前端重構驗收標準」最直接有用的一份，應該影響後續設計規格文件的寫法本身（可判定句式優先），而不只是設計美學層面。

### 3.L pbakaus/impeccable、vercel-labs web-design-guidelines、anthropics frontend-design — 本地已有，見第 0 節。

### 3.M AccessLint/skills
- **一句話定位**：Claude Code 專用的無障礙審查工具，三個技能 `accesslint:scan`（全頁掃描）、`accesslint:diff`（變更前後差異審查）、`accesslint:audit`（產報告或自動修正），涵蓋 WCAG 2.2 A/AA。
- **可採納原則**：
  - 可感知（alt 文字、對比度、結構）、可操作（鍵盤導覽、焦點管理）、可理解（標籤、語言設定）、穩健（ARIA、無障礙名稱）四大分類逐一檢查。
  - 支援即時 DOM 審查（Chrome DevTools Protocol），可與 Playwright/Puppeteer 類 MCP 整合做已登入狀態下的審查。
  - `diff` 模式（只看變更前後新增/修復的違規）特別適合重構過程中持續追蹤，避免每次全頁重掃。
- **適用性判斷**：高度適用。ShareGood 面向一般民眾（含年長者、行動不便者等真實使用者），且本地未有專門的無障礙掃描技能，此資源是這次調研中「本地缺口最明確」的一項，重構驗收應納入其四大分類逐項檢查。

### 3.N lottiefiles/motion-design-skill — 本地已有，見第 0 節。

### 3.O github/awesome-copilot 的 web-design-reviewer
- **一句話定位**：四階段視覺審查與修復流程（資訊蒐集→視覺檢查→問題修復→重新驗證），支援 Next.js 等全棧框架。
- **可採納原則**：
  - 固定測試四種視窗尺寸：375px（行動）、768px（平板）、1280px（桌面）、1920px（寬屏）。
  - 檢查項目具體到可判定：元素溢出/重疊/對齊、響應式破版、觸控目標過小、對比度不足、缺焦點狀態、缺 alt 文字、字型/色彩/間距不一致。
  - 問題依 P1（緊急）/P2（次要）/P3（輕微）分級，修復遵循最小化修改原則（不隨意重寫整個元件）。
  - 修復後必須截圖前後對比＋檢查迴歸，若單一問題超過 3 次嘗試仍解不掉要停下來問使用者（呼應本專案 `CLAUDE.md` 硬規則 5「同一問題重試超過 5 次工具呼叫要落一課」的精神，門檻數字不同但方向一致）。
- **適用性判斷**：高度適用，直接可作為前端重構「驗收流程」的骨架，四個視窗尺寸與 P1/P2/P3 分級可直接搬進驗收清單。

---

## 4. 圖示/Lottie/Motion

- **lottiefiles/motion-design-skill**（本地 motion-design）與 **diffusionstudio/lottie**（本地 text-to-lottie 的上游來源）：皆已在本地，確認可直接使用，不需額外處理。ShareGood 目前產品形態（列表、表單、通知為主）預期只需要輕量的微互動與載入動效，不需要重度 Lottie 場景動畫；若後續要做「感謝」「完成交接」等慶祝型微動效，可用本地 motion-design + text-to-lottie 產出但務必控制檔案大小與播放器成本。

---

## 5. 綜合：本次前端重構應遵守的具體設計守則（共 25 條）

行動裝置與觸控
1. 觸控目標尺寸 ≥44×44px。〔web-design-reviewer；platform-design-skills〕
2. 版面設計從 375px 寬度開始寫 `min-width` media query 向上擴展，不要從桌面版縮小改造。〔designer-skills〕
3. 響應式驗收固定測試四種視窗寬度：375 / 768 / 1280 / 1920px。〔web-design-reviewer〕

無障礙（WCAG 2.2 AA 底線）
4. 每次審查覆蓋四大類：可感知（alt 文字、對比度、結構）、可操作（鍵盤導覽、焦點管理）、可理解（標籤、語言）、穩健（ARIA、無障礙名稱）。〔AccessLint；platform-design-skills〕
5. 色彩對比不足、缺焦點狀態（focus state）、缺圖片替代文字列為 P1 必修項，不可留到之後。〔web-design-reviewer；AccessLint〕
6. 變更程式碼後用 diff 模式重新掃描，只看新增/修復的違規，避免每次全頁重掃拖慢流程。〔AccessLint〕

一致性與設計系統
7. 動工前先掃描既有 Tailwind 設定、CSS 變數、UI 元件目錄，禁止重複造出風格不一致的新元件。〔designer-skills；iliaal/ai-skills〕
8. 暗黑模式與亮色模式須雙套完整支援，走 CSS 自訂屬性切換，不要只做一套再事後補。〔designer-skills〕
9. Design tokens（色彩、間距、字體、動效時間）集中定義，light/dark 各一套。〔designer-skills〕
10. Tailwind v4 專案（ShareGood 現況即是）用 CSS-first 設定（`@theme`/`@utility`），禁止動態拼接 class 字串，優先 `gap` 勝過 `space-x`、`size-*` 勝過成對 `w-*/h-*`。〔iliaal/ai-skills，已核對 ShareGood `package.json: tailwindcss ^4`〕

美學決策的可執行性
11. 動工前用一句話寫下這次設計的哲學/調性聲明（例如：溫暖親和、資訊清楚、不炫技），而不是邊做邊拼湊。〔iliaal/ai-skills；Ilm-Alan/frontend-design〕
12. 色彩指導要用具體方向詞（大膽飽和／內斂柔和／高對比極簡）取代「好看」這種模糊形容詞。〔anthropics/skills PR #210〕
13. 所有設計指令要能在單一 session 內被驗證是否遵守，禁止寫「跟之前的都不要一樣」這種需要跨會話記憶的指令。〔anthropics/skills PR #210〕
14. 避免落入常見 AI 生成陳詞濫調（紫藍漸層、單一潮流字體、制式三卡英雄區），除非是刻意選擇並有理由。〔iliaal/ai-skills；garden-skills〕
15. 動效強度應對應受眾與情境設定為中低（一般民眾、非儀表板類操作），優先 hover 等低強度互動，避免炫技式滾動/磁性效果干擾操作。〔taste-skill；motion-design〕
16. 視覺密度對應受眾設為中低、寬敞排版，避免資訊過載（ShareGood 是給一般民眾用的共享平台，非專業儀表板）。〔taste-skill〕

資訊架構與任務拆解
17. 大規模前端改動前，先做一次資訊架構盤點（導覽、內容層級、頁面結構、使用者流程），再拆成可獨立驗收的垂直切片任務。〔designer-skills〕
18. 首頁若要接上真的列表 API（ShareGood 已知缺口：`src/app/page.tsx` 仍是 `DEMO_ITEMS`），需一併設計「無符合條件物品」等空狀態（empty state），不能只處理有資料的情境。〔jezweb/claude-skills 的 onboarding-ux 概念〕
19. 派工/拆解子任務時比照「部門化＋每個角色有明確可交付成果與成功指標」的做法，不要下籠統指令。〔agency-agents，呼應 ShareGood `delegation-templates.md`〕

驗收與修復流程
20. 問題依 P1（緊急）/P2（次要）/P3（輕微）分級處理，優先修 P1。〔web-design-reviewer〕
21. 修復介面問題遵循最小化修改原則，禁止藉機重寫整個元件。〔web-design-reviewer〕
22. 修復前後要截圖對比並檢查是否造成新的迴歸。〔web-design-reviewer〕
23. React/Next.js 重構要遵守：狀態依用途分工具（伺服器狀態/客戶端狀態/URL 狀態各自處理）、Server Actions 視為公開端點需比照 API 做權限檢查。〔iliaal/ai-skills，呼應 ShareGood 硬規則 6〕

Lottie/動效資產
24. 需要慶祝型/完成型微動效時（如感謝留言、交接完成）才引入 Lottie，且要控制檔案大小與播放器成本，不要為動效而動效。〔text-to-lottie / diffusionstudio/lottie；motion-design〕

跨資源共通原則
25. 任何設計/審查技能引入本專案時，先確認它產出的是「可判定的規則」而非「風格氛圍描述」，這是這次調研裡最一致的跨資源結論（designer-skills、iliaal/ai-skills、anthropics PR #210、web-design-reviewer 都各自獨立強調同一件事）。〔綜合〕

---

## 6. 明確不採納清單

- **threejs-skills（CloudAI-X）**：3D/WebGL 專精技能。ShareGood 無沉浸式/3D 展示需求，引入只增加 bundle size 與維護成本，與「行動優先、輕量化」定位衝突。
- **garden-skills 的 web-video-presentation／gpt-image-2／kb-retriever／beautiful-article**：分別是簡報生成、AI 圖片生成、知識庫檢索、文章排版工具，與「前端重構」方法論無關；僅其 `web-design-engineer` 一項概念性參考已納入第 5 節。
- **jezweb/claude-skills 的 favicon-gen／icon-set-generator／ai-image-generator／seo-local-business**：一次性資產生成工具，ShareGood 已有 MinIO 圖片管線與既有 SEO/AEO 實作（PR #11），不需重新引入；同 repo 的 responsiveness-check/ux-audit/onboarding-ux 概念已納入第 5 節。
- **ui-skills（ibelick）**：定位是 CLI 查詢工具/獨立網站（ui-skills.com），非可直接落檔的規則集合，其分類查詢概念已被本地 ui-ux-pro-max 涵蓋，不重複引入。
- **Ilm-Alan/frontend-design 的完整八美學錨點**：多數錨點（Brutalist、Chaotic Maximalism、Retro-Futuristic 等）偏實驗性/強烈風格，與「面向一般民眾、需要親和信任感」的平台定位不吻合；僅「先定調再動工」的流程概念已納入第 5 節，具體錨點不整套採用。
- **awesome-claude-skills（ComposioHQ）條列的個別工具**：本身是索引清單非方法論，其中 Figma Automation、Canvas Design、Theme Factory 等與目前純 Next.js/Tailwind 重構情境關聯度低，僅記錄已查閱過。
- **agency-agents 的行銷/業務/GIS/遊戲開發等非前端部門**：與本次前端重構任務無關，僅「部門化任務分派」概念已納入第 5 節第 19 條。
- **platform-design-skills 的 iOS/iPadOS/macOS/watchOS/visionOS/tvOS/Android 七個平台模組**：ShareGood 是純 Web 服務，無原生 App，僅 Web 模組相關內容已納入。

---

## 7. 無法取得的資源清單

無。本次指定的全部資源皆成功透過 WebFetch（部分輔以一次 WebSearch 交叉驗證）取得可用摘要內容，未有完全無法存取的項目。
（註：GitHub MCP 工具因本 session 僅授權 `nomoneydaddy/sharegood` 一個 repo，對所有外部 repo 呼叫皆被拒絕；改用 WebFetch 直接讀取 github.com 公開頁面與 raw.githubusercontent.com 取得內容，效果等同。）
