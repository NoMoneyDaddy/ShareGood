# 模型調度守則（Model Dispatch）

> 讀者：主對話模型（指揮官）。目的：用最少 token、最低錯誤率完成任務。
> 本檔的判準全部按本環境實際可用的參數寫成，不要憑印象改。

## 0. 本環境實際可用的參數（2026-07 盤點）

- **Agent tool 的 `model` 參數**：`sonnet`｜`opus`｜`haiku`｜`fable`。
  注意：`fable` 只在特定 session 可用；日常環境拿不到，守則預設不依賴它。
- **`effort` 參數**（Agent/Workflow 皆有）：`low`｜`medium`｜`high`｜`xhigh`｜`max`。
- **內建 agent 類型**（`subagent_type`）：
  - `Explore`：唯讀搜索。掃 repo、找定義、確認慣例用它。不能改檔。
  - `Plan`：設計實作方案，回傳步驟與關鍵檔案。不能改檔。
  - `general-purpose`：可讀可寫可跑指令的通用工人。實作、重構、驗證用它。
  - `claude-code-guide`：查 Claude Code / Agent SDK / API 用法時用。
- 省略 `model` 參數時 subagent 繼承主對話的模型。**派工時一律顯式指定 model 與 effort**，不要用繼承。

## 1. 開 session 時選什麼等級當指揮官

使用者混用多種模型，按任務型態選：

| 任務型態 | 指揮官建議 | 理由 |
|---|---|---|
| 照 master-plan 執行一個明確 milestone | Sonnet | 規格已寫死，照做即可，貴模型浪費 |
| 修 bug、寫測試、小功能、文件更新 | Sonnet（簡單的可 Haiku） | 範圍小、判準明確 |
| 架構決策、資料模型設計、安全審查 | Opus | 判斷密集，錯了很貴 |
| 上線前總驗收、跨模組除錯 | Opus | 需要跨域推理 |
| 改制度檔（governance/）本身 | Opus | 制度錯誤會放大到所有後續 session |

## 2. 指揮官不下場（最重要的一條）

指揮官的 context 要留給：使用者的要求、決策、進度。原始內容一律派工。

**必須派工的情境（門檻寫死）：**
- 預估要讀 **超過 3 個檔案**，或 **單檔超過 400 行** → `Explore`。
- 掃 repo 找「某東西在哪／有沒有既有實作」→ `Explore`。
- 讀任何網頁、查任何外部文件 → `general-purpose`（或 `claude-code-guide`），只回結論。
- 批次改檔（同一模式改 3 個以上檔案）→ `general-purpose`。
- 跑一輪完整測試並解讀失敗原因 → `general-purpose`。

**指揮官可以自己做的：**
- Read 接下來就要 Edit 的那個檔案（Edit 工具要求）。
- 單一精準的 Grep/Glob（已知大概位置，只是確認）。
- 幾行的小 Edit、單一指令的 Bash。
- 與使用者的所有溝通、所有決策。

## 3. 派工三件套（缺一不派）

每個派工 prompt 必含三段（模板見 `delegation-templates.md`）：
1. **目標與動機**：做什麼＋為什麼做（弱模型知道動機才不會在邊界情況亂猜）。
2. **驗收條件**：可判定的清單。「寫得好」不是驗收條件；「`npm test` 全綠」「回傳的每個結論附 file:line」才是。
3. **回報格式**：回什麼、多長、附什麼證據。

## 4. 派工的 model / effort 對照表

| 子任務 | subagent_type | model | effort |
|---|---|---|---|
| 掃 repo、找定義、確認慣例 | Explore | haiku | low–medium |
| 大範圍搜索（多處命名、跨模組） | Explore | sonnet | medium |
| 查外部文件、網頁研究 | general-purpose | sonnet | medium |
| 照規格實作（規格明確） | general-purpose | sonnet | medium–high |
| 實作（規格模糊、要自己補設計） | general-purpose | opus | high |
| 機械式批次修改（模式已解出） | general-purpose | haiku | low |
| 設計方案、拆解 | Plan | sonnet 起步，重要的用 opus | high |
| 驗收／read-back／跑測試 | general-purpose | sonnet | medium |
| 安全審查、高風險第二意見 | general-purpose | opus | high |

原則：**規格越明確 → 模型越便宜；判斷成分越高 → 模型越貴。** effort 超過 high 只留給
「錯了很貴、又無法事後便宜驗證」的任務。

## 5. 回報合約（subagent 必須遵守，寫進每個派工 prompt）

- 只回 **結論**，引用處標 `file_path:line`，不要貼大段原文。
- 長產物（報告、大 diff 說明、掃描結果）**落檔**到指定路徑，回報只給路徑＋不超過 5 行摘要。
- 每個「已完成」聲明必附證據：測試輸出、指令結果、或 file:line。
- 做不到或不確定就明說「做不到／不確定＋原因」，禁止用含糊語（「應該可以」「大致完成」）掩蓋。
- 回報上限：無特別約定時 300 字以內。

## 6. 升降級路徑

- **Haiku 失敗 1 次** → 直接升 Sonnet 重派。不給 Haiku 第二次機會（重試成本高於升級成本）。
- **Sonnet 同一子任務連錯 2 次** → 升 Opus，且必須附上**完整失敗軌跡**（兩次都試了什麼、錯誤訊息原文、
  當前猜測），不是只把原始任務重丟一次。
- **Opus 也解不了** → 停下來，把問題與失敗軌跡整理給使用者，明說卡在哪。不要第三次重試。
- **降級**：貴模型解出「模式」後（例如：確定了某類修改的正確做法），把模式寫成明確指令，
  降回 haiku/sonnet 批次套用到其餘位置。
- **重試上限**：同一件事同一等級最多 2 輪。第 2 輪失敗就升級或換路（換路判準見
  `judgment-rubrics.md` §4），禁止无變化地第 3 次重試。

## 7. 驗證不自驗

- 寫的人不驗收。驗收派 **fresh-context** 的新 subagent（prompt 裡只給驗收條件與必要背景，
  不給實作過程），避免被實作者的思路帶著走。
- 驗收方法按產物類型：
  - **檔案／文件** → read-back：實際打開，逐條對驗收清單。
  - **程式碼** → 跑測試或實跑（起 dev server、curl API、看實際輸出）。type check 通過不算驗收。
  - **高風險判斷**（資料模型、安全、不可逆操作）→ 第二意見：另派一個 opus agent 獨立評估；
    或多答案評審（讓 2–3 個 agent 各給方案，再派一個評審 agent 選優並說理由）。
- 驗收不過 → 帶著驗收報告回給原等級修一次；再不過走 §6 升級。

## 8. 並行原則

- 互相獨立的子任務**同一則訊息一次派出**（多個 tool call 並行），不要串行等待。
- 有依賴關係的（B 要用 A 的結果）才串行。
- 派出去之後不要自己動手做同一件事（重複燒 token）。
