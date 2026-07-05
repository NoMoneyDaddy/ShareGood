# `pkill -f "a\|b"` 不會做 OR 比對，殺不掉背景 next-server，導致重新截圖看到舊版樣式

- 日期：2026-07-05
- 情境：重新設計首頁後，反覆用 `NODE_ENV=production npx next start -p 3100`（背景執行）驗證改動，
  每次改完 CSS/token 都要重新截圖確認。
- 症狀：改了 `globals.css`（如品牌色的對比度校正）、重新 `npm run build`、重啟伺服器後，
  Playwright 截圖仍顯示**完全沒有樣式**或**改動前的舊樣式**。`curl localhost:3100/` 回 200，
  容易誤判「伺服器正常、一定是程式碼寫錯」。
- 原因：用 `pkill -9 -f "next-server\|next start"` 想殺掉舊行程，但 pkill 的 `-f` 比對是把整個
  pattern 字串當一個 regex，**bash 單引號內的 `\|` 不會被 pkill 當成 OR**（那是 grep BRE 的語法，
  pkill 底層用的 regex 引擎不保證支援）。於是舊的 `next-server` 行程沒被殺掉，繼續佔用 port 3100；
  新的 `next start` 因為 `EADDRINUSE` 直接啟動失敗、行程隨即結束，但**舊行程還在**回應 curl 的 200，
  讓人誤以為新伺服器啟動成功。
- 修法：不要用 `pkill -f` 猜行程名稱，改用 port 精確定位：`fuser -k 3100/tcp`（或
  `ss -ltnp | grep 3100` 找 PID 後 `kill -9`）。啟動新伺服器後，**看啟動 log 裡有沒有
  `✓ Ready in Xms`**，這是唯一可信的「這是全新行程」證據；只看 curl 200 不夠。
- 引申規則：任何「改了設定/樣式，重跑背景伺服器驗證，結果看起來像沒改到」的情況，
  第一件事是確認 port 上真的換了行程（看啟動 log 或用 port 找 PID），不要先懷疑程式碼寫錯。
