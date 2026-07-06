# 備份還原演練紀錄

> 每次演練（例行季度、schema 重大變更觸發式、或真實事故補記）完成後在下表追加一列。
> 頻率與步驟見 [`backup-restore.md`](./backup-restore.md)。

| 日期 | 操作者 | 類型（例行／觸發式／事故補記） | 耗時 | 是否成功 | 遇到的問題與解法 |
|---|---|---|---|---|---|
| 2026-07-06 | Claude（M8 開發 session，非正式站） | 觸發式（M8 schema／runbook 落地後的首次演練，非正式站資料）| pg_dump 1s、pg_restore 2s | 成功 | 在本機開發用的一次性測試資料庫（`sharegood_m8ops`，非 Zeabur 正式站）執行：`pg_dump -F c` 出檔→在另一個乾淨資料庫 `pg_restore --clean --if-exists` →`prisma migrate status` 回報 schema 對齊→還原前後 `users`/`items`/`cities`/`categories` 筆數相符（0/0/22/9）。**已知限制**：本環境沒有可用的 MinIO 服務，`mc mirror` 這段沒有實際跑過，只在 `backup-restore.md` 留了指令範例；下一次對正式站環境的演練需要補這段。正式站的第一次真實季度演練仍待日後對 Zeabur 正式資料庫與 MinIO 執行並補寫這裡。 |
