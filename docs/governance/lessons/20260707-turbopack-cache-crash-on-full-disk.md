# 磁碟滿時 Turbopack 快取崩潰會偽裝成大規模測試失敗

**一行結論**：全套 vitest 出現「大量測試檔在檔案層級失敗、單檔重跑卻全過」時，第一件事是
`df -h`——磁碟滿會讓 Next.js dev server 的 Turbopack 持久快取在測試中途崩潰
（`Compaction failed: Another write batch or compaction is already active`），伺服器死掉後
剩餘測試檔全數斷線失敗，看起來像程式碼問題。

## 症狀怎麼認

1. 全套 vitest 跑到一半後的測試檔整批失敗，但個別重跑任一檔案都通過。
2. 通過的案例數遠低於總數（例如 266 只跑出 78），表示多數檔案根本沒執行到測試本體。
3. dev server log 尾端出現 Turbopack `Compaction failed` 與 Rust stack backtrace。
4. 更早的徵兆：vitest 卡住不動（本例卡了 46 分鐘），因為所有 HTTP 請求都在等一個死掉的
   server。

## 錯誤的排查方向（本例都試過、都白費）

- 懷疑 feature flag 殘留（REQUIRE_REVIEW）——查了是 false。
- 懷疑 DB 連線耗盡——16/100，正常。
- 換 `next dev --webpack` 繞過 Turbopack——webpack 首次編譯太慢，server 在探測窗口內
  起不來，反而製造第二種假失敗。

## 修法

1. `df -h` 確認磁碟；本例 98%（剩 876MB）。
2. 清理已完工代理的整個 worktree（不是只清 `.next`）：
   `git worktree remove --force <path>`——每個 worktree 的 node_modules 約 1.3GB，
   `.next` 又 0.3–1.5GB，十幾個累積起來就是 20GB+。
3. 殺乾淨殭屍 vitest／next 程序後（`pkill -f vitest`；注意 worker 子程序），
   `rm -rf .next` 重啟 dev server 再跑，即回到基準。

## 預防

- 平行代理 wave 結束、PR 合併後，**立即移除該代理的 worktree**，不要等磁碟報警。
- 派工模板的環境段已要求各代理自建獨立 DB；worktree 生命週期管理是指揮官的責任。
- 同日稍早已有一次磁碟滿事故（見 `20260707-shared-disk-exhaustion-during-m9-parallel-work.md`），
  本篇是它的變體：這次不是 postgres 斷線，而是 Turbopack 快取崩潰，症狀更有迷惑性。

（2026-07-07）
