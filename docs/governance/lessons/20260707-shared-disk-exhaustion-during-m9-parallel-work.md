# 多個平行 worktree 共用同一顆磁碟，`.next`／npm `_npx` 快取＋postgres 同時被擠爆，導致
# postgres 當機、`vitest run` 整套測試中途 `ENOSPC` 消失

- 日期：2026-07-07
- 情境：M9 交付內容 4/5/6（票券/點數類型）派工，跟另外兩個平行 agent（`feature/m9-deal-info`、
  `feature/m9-coupon-enhancements`）同時在各自的 git worktree 裡跑 `next dev`／
  `next build`／`npx vitest run` 驗收。
- 症狀：第一次 `npx tsc --noEmit` 就直接失敗，錯誤是 harness 層級的
  `ENOSPC: no space left on device`（連指令輸出都寫不出來）；後續 `npx vitest run`
  整套測試跑到一半，postgres 直接斷線（`Can't reach database server at 127.0.0.1:5432`），
  `service postgresql status` 顯示 `down`。
- 根本原因：`df -h /` 顯示磁碟總大小雖然是 252G，但**實際可寫入配額遠小於這個數字**
  （用量到 36-38G 左右就會顯示 100%、可用空間掉到個位數 MB）——這台機器上同時存在十幾個
  `.claude/worktrees/agent-*` 目錄，每個都各自有一份完整 `node_modules`（約 1.3G／個），
  累計起來就是十幾 GB，加上每個 agent 各自的 `next dev`／`next build`（`.next` 快取每次
  約 400-450M）、`npm`/`npx` 快取（`~/.npm/_npx` 會累積到 500-600M）、postgres WAL，
  多個 session 同時動作時磁碟配額很容易被瞬間擠滿，而且**這是所有平行 agent共用的系統級
  資源，不是單一 worktree 自己的問題**。
- 修法（依安全程度排序，優先用前面的）：
  1. `rm -rf /root/.npm/_npx`、`rm -rf /root/.cache/*`、`apt-get clean`——這幾個是純快取，
     跟任何 agent 的工作內容無關，可以放心清，每次能回收數百 MB 到 2GB 不等。
  2. 清掉自己 worktree 裡的 `.next`（`rm -rf .next`）——建置快取，`next dev`/`next build`
     會自動重建，不影響正確性，只是下次啟動要重新編譯。
  3. **絕對不要**嘗試刪除別的 worktree（即使看起來像是已合併完成的舊分支，例如
     `agent-m2-admin-backend`、`agent-m5-lottery` 這類跟已完成 milestone 同名的資料夾）：
     `git worktree list` 顯示的 `locked` 標記才是「目前有 agent 在用」的可靠依據
     （本次跑的三個 M9 平行 agent 各自的 worktree 都是 `locked`；其餘沒鎖的雖然看起來像
     孤兒目錄，但 harness 的權限分類器會直接擋下「大量刪除其他 worktree」的操作——這是
     故意設計的安全閘門，不要嘗試繞過，也不要因為權限被拒就切換到其他指令硬做同一件事）。
  4. postgres 因為 `ENOSPC` 斷線後，光是 `df -h` 回穩不代表資料庫自己會恢復；要手動
     `service postgresql start` 重啟，重啟後跑一次 `psql ... -c "select count(*) from ..."`
     確認資料還在（沒有被截斷/損毀）才能放心繼續。
  5. 因為中途斷線，測試的 `afterAll` 清理沒跑完，資料庫會留下孤兒測試資料（`user.email
     like '%@e2e.sharegood.test'`），下次整套測試前先手動
     `delete from users where email like '%@e2e.sharegood.test'` 清掉，避免干擾下一輪。
- 引申規則：**磁碟滿是這個環境的系統級風險，不是「我的程式碼寫錯了」的訊號**——遇到
  `ENOSPC`／postgres 斷線／`next build` 莫名失敗，第一件事是 `df -h /` 確認可用空間，
  不要急著懷疑自己剛寫的程式碼。清快取（`_npx`／`.next`／apt）永遠優先於任何跟其他
  worktree 有關的操作；如果權限系統擋下某個清理動作，代表那個動作範圍太大，換更小範圍的
  替代方案（清自己的東西），不要重試或找別的工具繞過去。跑完整套 `vitest run` 前後都
  `df -h` 一次，中途如果掉到 1GB 以下就先暫停清快取，不要硬跑下去等它自然爆掉。
