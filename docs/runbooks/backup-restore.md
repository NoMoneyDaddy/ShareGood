# 備份與還原 Runbook

> master-plan.md §8a 交付內容 4。這份文件定義「備份還原演練」該怎麼做、多久做一次、
> 演練紀錄寫在哪裡。**只在真的要備份／還原（含演練）時才照著做**，不是自動化腳本。

## 頻率

- **每季一次**（quarterly）例行演練。
- 任何一次 schema 有重大變更（新增／修改核心表）後，**額外加演練一次**（觸發式，不算進
  季度例行的計數）。
- 任何一次因真實事故而執行的還原，**視同已完成當季演練**，補寫紀錄即可，不必再另外重演一次。

演練結果一律記錄到 [`docs/runbooks/backup-drill-log.md`](./backup-drill-log.md)。

## 1. PostgreSQL 備份

用 `pg_dump` 搭配 custom format（`-F c`，壓縮、支援選擇性還原與 `pg_restore` 平行還原），
透過 `DATABASE_URL` 對外連線字串執行，由 admin 手動於自己機器執行並下載保存：

```bash
pg_dump "$DATABASE_URL" -F c -f sharegood_$(date +%Y%m%d).dump
```

- `-F c`（`--format=custom`）：custom-format archive，是 `pg_dump` 官方文件建議搭配
  `pg_restore` 使用的格式（預設壓縮，允許選擇性還原與重新排序物件）。
- `-f <file>`：輸出檔案路徑（custom format 底下 `-f` 指定輸出檔，不是資料夾）。
- `dbname` 參數可以直接是一個 connection string／URI（`DATABASE_URL` 本身就是），
  connection string 裡的參數會覆蓋掉命令列上衝突的選項。
- 備份完成後，**把 `.dump` 檔案下載到 Zeabur 主機以外的地方**（自己的筆電、雲端硬碟等）。
  這是「資料要有異地副本」的底線，跟 master-plan §8a「不做多區域備援」的 scope guard
  不衝突——後者講的是**服務**層級的容錯 failover，這裡只是**資料**要有一份不在同一台
  主機上的副本，是不同層次的規格。

參考：[PostgreSQL 官方文件：pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)。

## 2. PostgreSQL 還原

```bash
pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" sharegood_YYYYMMDD.dump
```

- `--clean`（`-c`）：還原前先對即將還原的物件下 `DROP`，適合「覆蓋一個已存在的資料庫」
  這種情境。
- `--if-exists`：`--clean` 模式下的 `DROP` 一律加 `IF EXISTS`，避免「目的地資料庫本來就
  沒有這個物件」時噴一堆可忽略的錯誤訊息（必須跟 `--clean` 一起用）。
- `-d`（`--dbname`）：要還原進去的目標資料庫，一樣可以直接放 connection string；
  **絕對不要把 `$TARGET_DATABASE_URL` 指向正式站的 `DATABASE_URL`**，除非真的是要復原
  正式站（正常演練請指向另一個測試用 PostgreSQL 實例）。

參考：
[PostgreSQL 官方文件：pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)。

### 還原後驗證步驟

還原完成後**一定要跑完以下兩步才算演練成功**，不是「指令沒報錯」就結束：

1. **migration 對齊**：

   ```bash
   npx prisma migrate status
   ```

   預期輸出所有 migration 都是 "Applied"，沒有 "pending" 或 "drifted"。如果目標資料庫
   是全新建立的，這一步同時驗證了「這份備份可以在一個完全乾淨的環境上復原出完整、
   對齊當前 schema 的資料庫」。

2. **關鍵表筆數比對**：跑幾條基本 `COUNT(*)`，跟備份當下（`pg_dump` 執行前）的筆數相符。
   例如：

   ```sql
   SELECT
     (SELECT COUNT(*) FROM users) AS users,
     (SELECT COUNT(*) FROM items) AS items,
     (SELECT COUNT(*) FROM notifications) AS notifications,
     (SELECT COUNT(*) FROM storage_objects) AS storage_objects;
   ```

   把備份前後的數字寫進演練紀錄（見下方 `backup-drill-log.md`）。

## 3. MinIO 資料備份

用 [MinIO Client](https://docs.min.io/community/minio-object-store/reference/minio-mc/mc-mirror.html)
（`mc`）鏡像整個 bucket 到本地磁碟或第二個 S3 相容目的地。

先設定一次 alias（之後每次演練重用，不用每次重設）：

```bash
mc alias set sharegood-minio "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
```

備份（鏡像到本地資料夾）：

```bash
mc mirror sharegood-minio/sharegood ./minio-backup-$(date +%Y%m%d)/
```

還原（反向鏡像回去；`--overwrite` 讓目的地既有物件被來源版本覆蓋，還原情境下通常就是要
覆蓋回備份當下的狀態）：

```bash
mc mirror --overwrite ./minio-backup-YYYYMMDD/ sharegood-minio/sharegood
```

- `mc mirror SOURCE TARGET` 是同步物件到目的端的核心指令，來源與目的地都可以是本地路徑
  或 `<alias>/<bucket>[/prefix]` 形式。
- `--overwrite`：用來源版本覆蓋目的端既有物件（還原時通常需要）。
- 演練時可以先對一個測試用 bucket 或前綴做，不必每次都動正式 bucket 的全部內容；
  真的還原正式資料時再對完整 bucket 執行。

參考：
[MinIO 官方文件：mc mirror](https://docs.min.io/community/minio-object-store/reference/minio-mc/mc-mirror.html)。

## 4. 演練紀錄

每次演練（例行季度、觸發式、或真實事故補記）完成後，在
[`docs/runbooks/backup-drill-log.md`](./backup-drill-log.md) 追加一列，格式固定（日期、
操作者、耗時、是否成功、遇到的問題與解法），方便日後稽核「真的有定期演練」而不是紙上流程。
