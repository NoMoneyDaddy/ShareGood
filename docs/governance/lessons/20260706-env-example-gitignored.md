# `.gitignore` 的 `.env*` 規則把 `.env.example` 也擋掉了，這個檔案從 M0 以來沒有真的進版控

- 日期：2026-07-06
- 情境：修正時區設定時要更新 `.env.example`，用 Edit 工具寫入後想 commit。
- 症狀：`git status` 完全沒顯示 `.env.example` 被修改；`git diff HEAD -- .env.example`
  回報「檔案存在於硬碟但不在 HEAD」——代表這個檔案從 M0 建立以來**從來沒有被 commit 過**，
  但沒有任何錯誤訊息提醒過（`git add` 對 gitignore 掉的檔案預設靜默跳過）。
- 原因：`.gitignore` 有一條 `.env*`（原意是擋掉 `.env`、`.env.local` 等含密鑰的檔案），
  但這個 glob 連 `.env.example` 也一起擋掉了。`.env.example` 依照 master-plan §3.4 的設計
  本來就該進 repo（只有 key 沒有 value），結果整個 M0 開發期間它其實只存在於工作目錄，
  沒有人真的拿到它。
- 修法：`.gitignore` 加一行 `!.env.example` 明確排除；用 `git add -f` 把已經寫在硬碟上、
  一直沒進版控的檔案強制加回去。
- 引申規則：`.env*` 這類萬用字元規則要小心誤傷「範例/模板」檔案（`.env.example`、
  `.env.sample`、`.env.template`）。改完 `.gitignore` 或懷疑某檔案「明明改了但沒出現在
  git status」時，用 `git check-ignore -v <path>` 直接確認是哪條規則擋住的，不要假設沒訊息
  就代表沒問題。
