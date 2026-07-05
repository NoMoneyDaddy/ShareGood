# Lessons 索引

> 一課一檔。寫法與時機見 `../maintenance-protocol.md` §3。
> 新 session 開場時：掃一眼下方索引，跟今天任務相關的才點開讀。

## 索引（新增檔案時把一行結論登記到這裡）

| 檔案 | 一行結論 |
|---|---|
| `20260705-node-env-breaks-next-build.md` | 本環境 shell 預設 NODE_ENV=development 會弄壞 next build；build script 已寫死 production |
| `20260705-zeabur-cli-gotchas.md` | Zeabur CLI：variable create 不覆寫（改值用 update）、旗標名每個子指令先 --help、自動化加 -y --interactive=false |
| `20260705-stale-server-pkill-pattern.md` | pkill -f "a\|b" 不做 OR 比對，殺不掉背景 next-server；改用 port 精確 kill，並看啟動 log 的 Ready 訊息驗證 |
| `20260705-skills-cli-agents-dir-is-real-content.md` | `npx skills add` 裝的 `.claude/skills/<name>` 常是 symlink，真身在 `.agents/`；刪 `.agents/` 前先確認沒有還在用的 skill 指向它 |
| `20260706-env-example-gitignored.md` | `.gitignore` 的 `.env*` 連 `.env.example` 都擋掉，該檔案從 M0 起從未真正進版控；已加 `!.env.example` 例外並補回 |
