# `.claude/skills/<name>` 從 `npx skills add` 裝的可能是 symlink，真身在 `.agents/`——刪 `.agents/` 會讓 skill 失效

- 日期：2026-07-05
- 情境：清理「一次裝了整包不需要的 skill」的殘留，想只留下實際用到的 `ui-ux-pro-max`。
- 症狀：`rm -rf .agents && rm -rf .claude/skills/<未用到的skill>`（只留 ui-ux-pro-max）之後，
  之後跑 `biome check` 才發現 `.claude/skills/ui-ux-pro-max` 變成**指向不存在目錄的死連結**
  （`ls` 顯示 `No such file or directory`），而且這個壞掉的狀態已經被 commit 進 git。
- 原因：`npx skills add` 這類「多 agent 通用」skill 安裝器，會把**真正的檔案**裝進
  `.agents/skills/<name>/`，然後在 `.claude/skills/<name>` 建一個**symlink**指過去
  （這樣同一份 skill 內容可以被 Claude Code、Cursor、Codex 等多種 harness 共用）。
  `.agents/` 不是「另一份重複的備份」，是唯一的真身；`.claude/skills/<name>` 只是捷徑。
  誤把 `.agents/` 當成可丟棄的重複內容整個刪掉，就砍斷了所有還在用的 skill。
- 修法：只清理「不要的 skill」時，要**同時處理 `.claude/skills/<name>` 與 `.agents/skills/<name>`
  這一對**，不要整個 `.agents/` 目錄一起刪。清乾淨後用
  `ls -la .claude/skills/<name>` 確認不是死連結（`No such file or directory` = 已經壞了），
  必要時重新 `npx skills add <repo> --skill <name>` 補回來。
- 引申規則：看到某檔案是 symlink（`ls -la` 開頭 `l`），先 `readlink` 或 `ls` 目標路徑確認
  目標是否還存在，再決定能不能刪掉「看起來重複」的來源目錄。
