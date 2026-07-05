# ShareGood 好物共享

台灣縣市級免費共享平台：把用不到的好物分享給需要的人。**不做金流、不做物流、不做交換、不做社區圈。**
技術棧：Next.js monolith + PostgreSQL + Prisma + MinIO + Auth.js，部署 Zeabur。與使用者對話一律用繁體中文。

## 目前階段

- [x] 制度與規格建立（本檔與 docs/ 全部檔案）
- [ ] M0 Foundation（尚未開始；repo 還沒有程式碼）
- 之後每完成一個 milestone，就把上面清單勾掉並更新。

## 路由表：何時讀哪份檔案

| 情境 | 讀這份 |
|---|---|
| 任何開發任務開工前（必讀） | `docs/plan/master-plan.md`（唯一主控規格，只讀目前 milestone 那節＋通用慣例節） |
| 要派 subagent、選 model/effort | `docs/governance/model-dispatch.md` |
| 拿不準「算不算完成／該不該問使用者／要不要換路」 | `docs/governance/judgment-rubrics.md` |
| 要寫派工 prompt | `docs/governance/delegation-templates.md`（直接複製模板填空） |
| 想修改制度檔或計畫書 | `docs/governance/maintenance-protocol.md`（先讀，有分級授權） |
| session 開場、或接手交接 | `docs/governance/letter-to-future-sessions.md` ＋ `docs/governance/lessons/README.md` |
| 想了解 harness 常見失敗模式 | `docs/governance/diagnosis.md` |

`docs/plan/original-master-plan-v1.md` 是歷史備份，僅供考古，**不要**照它執行。

## 硬規則（不可違反；其餘細則在上表對應檔案裡）

1. **指揮官不下場**：預估要讀超過 3 個檔案、或單檔超過 400 行、或任何網頁 → 派 subagent（Explore 或
   general-purpose），要求只回結論與 file:line。例外：接下來要 Edit 的檔案自己 Read。
2. **派工帶三件套**：目標與動機、驗收條件、回報格式。缺一不派。
3. **驗證不自驗**：驗收派 fresh-context subagent；檔案用 read-back、程式碼用測試或實跑。
   沒有證據（測試輸出／指令結果／file:line）的「已完成」一律視為未完成。
4. **隨做隨 commit**：每完成一個可交付單位立即 commit（conventional 前綴：feat/fix/docs/…）。
   一個 session 只做一個 milestone 的工作，做完驗收、push 後結束。
5. **踩坑就落檔**：花超過 30 分鐘才解掉的問題，解掉後立即寫一課進 `docs/governance/lessons/`。
6. **安全底線**（寫程式碼時）：所有 mutation API 必須 server-side 權限檢查；圖片與大檔案不進
   PostgreSQL；所有列表查詢必分頁；秘密只放環境變數。細節見 master-plan.md 通用慣例節。
