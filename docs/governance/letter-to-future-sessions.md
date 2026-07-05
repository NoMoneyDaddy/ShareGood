# 給未來 session 的信

> 寫於 2026-07-05，制度建立 session（Fable 5）。讀者是之後接手的每一個模型——多半是 Sonnet 或
> Opus。這封信講三件使用者沒問、但對這個環境最重要的事，以及這套制度最可能怎麼壞掉。
> 開場順序建議：CLAUDE.md（已自動載入）→ 本檔 → lessons/README.md 索引 → 開工。

---

## 一、三件沒被問但最重要的事

### 1. 這個環境的生存規則：沒 push 的東西等於不存在

你多半跑在暫時性的遠端 container 裡。session 結束或閒置回收後，工作目錄一切消失。
所以：**commit 是逗號，push 才是句號**。每完成一個單位就 commit，session 收尾必 push。
另外幾個環境事實，別靠訓練記憶猜（都是 2026-07-05 實測，環境可能變，用前先驗）：
- GitHub 操作以 `mcp__github__*` 工具為準（ToolSearch 載入）。環境裡的 `gh` CLI ＋ `GH_TOKEN`
  **可用但僅限 REST**（`gh api repos/{owner}/{repo}/...` 正常）；GraphQL 被代理限制在固定的
  PR-review 操作集，所以 `gh repo view` 會 403、`gh auth status` 會**誤報 token invalid**——
  別被這個誤報騙了。`git push` 走環境內建 proxy，不吃這個 token，直接推即可。
- 主分支是 `main`（使用者明確指定）。日常開發開 `feature/*` 分支、push 後開 draft PR 讓使用者過目；
  純文件與制度維護類的小改，使用者若已授權可直接進 main。
- 部署金鑰：`ZEABUR_TOKEN` 已設定（Zeabur CLI 可經 `npx zeabur@latest` 使用）。環境旗標
  `INSTALL_ZEABUR_MCP=1`，但本 session 實測**沒有** Zeabur MCP 工具——先用 ToolSearch 查
  「zeabur」，有就用 MCP，沒有就用 CLI。

### 2. 使用者要的是「上線給真人用」，不是完美架構

原始計畫書規模很大（法務模組、抽籤稽核、訂閱系統……），那是願景不是工單。
master-plan v2 已經把砍線畫在 M4/v1.0。你的職責之一是**守住這條線**：
- 當使用者興起想在 M1 就加新功能，提醒他 v1.0 gate 的存在，把新想法登記到 M5+ 而不是現在做。
- 當進度與規格衝突，優先提議「砍範圍」而不是「降品質」——品質底線（judgment-rubrics §5）不打折。
- 溝通一律**繁體中文**；使用者接受一次性一批問題（≤5 題），之後自主作業。

### 3. M0 scaffolding 是全案最大的技術風險點，別憑記憶 init

repo 目前是空的。第一個寫程式碼的 session 會定下所有版本與骨架，錯了之後每個 session 都在還債。
明確要求：
- 動手前先派 research agent（模板 4）查**當前**的 Next.js / Prisma / Auth.js（next-auth v5+）/
  Tailwind / shadcn 版本相容組合與官方 scaffold 指令，附來源。你的訓練記憶裡的版本號幾乎必定過時。
- Auth.js 的 App Router 整合、Prisma 的 driver adapter、shadcn 的 init flow 這幾年變動頻繁，
  一律以官方文件為準（Context7 / claude-code-guide 都能查）。
- M0 驗收裡「乾淨 DB 從零跑通」那條，是在防 scaffolding 期最常見的「在我機器上可以跑」。

---

## 二、這套制度最可能的退化方式（與偵測、預防）

| 退化 | 徵兆 | 預防／處置 |
|---|---|---|
| CLAUDE.md 膨脹回大雜燴 | 超過 80 行；出現只跟單一 milestone 有關的細節 | maintenance-protocol §4 的瘦身規則：細節下放，只留路由 |
| 驗證被跳過（趕進度時第一個犧牲的就是它） | 連續多個 commit 的訊息裡沒有任何測試／實跑證據；「先合再說」出現 | 驗收不過就不勾進度、不報完成。發現上一個 session 跳過驗證 → 補驗，發現問題寫 lesson |
| lessons 沒人寫、寫了沒人讀 | 同一個坑第二次踩；lessons 索引長期空白但明明踩過坑 | 開場讀索引是 CLAUDE.md 路由表的一部分；踩坑 30 分鐘規則（maintenance-protocol §3） |
| 派工三件套變成形式 | 驗收條件寫成「功能正常運作」這類不可判定句 | 判定法：驗收條件必須能回答「用什麼指令／動作驗，看到什麼算過」。寫不出來就是還沒想清楚 |
| 制度檔互相矛盾越積越多 | 兩份檔對同一件事給出不同門檻 | 優先序：CLAUDE.md 硬規則 > model-dispatch > 其他；發現矛盾當場回報使用者並修檔 |
| 「特例」侵蝕硬規則 | 「這次情況特殊所以直接…」連續出現 | 特例要嘛寫成規則的正式例外（黃區流程），要嘛不做。口頭特例不留痕，等於制度失效 |

## 三、誠實條款：這套制度補不了什麼

制度能補的是**執行品質**：拆解、驗收、外部驗證、多樣本評審，Sonnet 等級照做就能接近高階模型的
產出下限。補不了的是：
1. **模糊題與品味**（UX 取捨、文案語氣、「使用者會不會喜歡」）——出路照 judgment-rubrics §6：
   升級模型出多方案＋trade-off、交使用者選、或明說建議找真人試。不要假裝有把握。
2. **真實世界的最新事實**（法規、價格、第三方限制）——查得到附來源，查不到標「未確認」。
3. **法律責任**——master-plan §12 的硬 gate 是「三個政策頁完成＋使用者過目」；台灣律師審閱
   是強烈建議但模型無法強制，上線前要明確提醒使用者這件事還沒做。

## 四、交接區（session 之間的未竟事項寫在這裡，完成就清掉）

- （2026-07-05 制度 session）交付 A–G 全部完成，並通過 fresh-context Sonnet 對抗審查
  （4 BLOCKER / 6 MINOR / 1 NIT 全數修正，最大教訓：Agent tool 沒有 effort 參數，
  投入度要寫進 prompt 文字）。
- （同日更新）M0 已由本 session 開工並大致完成（分支 `feature/m0-foundation`）：scaffold、
  Prisma 7 schema/migration/seed、Auth.js v5、RBAC、圖片管線、SEO 基礎、impeccable 皆已實測。
  **M0 尚缺三件事**：(1) Zeabur 建立三服務並部署（ZEABUR_TOKEN 可用）；(2) Google OAuth 正式
  憑證設定與真人登入→onboarding 流程實測；(3) MinIO 真實上傳驗證（本機無 MinIO，422 攔截已測）。
  補完後照 master-plan §5 驗收清單逐條打勾，才算 M0 完成。
- 技術要點：Auth.js v5 用 `AUTH_*` 環境變數；Prisma 7 連線在 `prisma.config.ts`；
  build 必須 NODE_ENV=production（見 lessons）。
- 使用者要求：全程繁體中文；善用高效 bash（model-dispatch §9）；前端設計用 impeccable。
