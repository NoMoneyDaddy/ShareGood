# `next.config.ts` 的 `next/image` remotePatterns 沒算進 `S3_PUBLIC_URL` 自帶的 bucket 路徑，本機任何帶圖片的頁面一律 500

- 日期：2026-07-06
- 情境：M3 優惠券功能要驗證物品詳情頁（`/items/[id]`）能正確顯示，照 `.env.example` 把
  `S3_PUBLIC_URL="http://localhost:9000/sharegood"` 填進 worktree 的 `.env` 之後，任何有
  圖片的物品詳情頁 SSR 一律回 500（連既有的 `e2e/integration/seo.test.ts` 都一起壞掉，
  跟 M3 改動完全無關）。
- 症狀：伺服器 log 出現 `Error: Invalid src prop (http://localhost:9000/sharegood/images/
  <uuid>/medium.webp) on next/image, hostname "localhost" is not configured under images in
  your next.config.js`；`rm -rf .next` 乾淨重啟（見另一則 turbopack 快取教訓）也沒用，代表
  不是快取問題，是 `next.config.ts` 的 `images.remotePatterns` 設定本身就比對不到這個 URL。
- 原因：`next.config.ts` 用 `S3_PUBLIC_URL` 的 protocol/hostname/port 組 remotePattern，但
  `pathname` 寫死成 `"/images/**"`；`src/lib/storage.ts` 的 `publicUrl()` 組出來的實際路徑是
  `${S3_PUBLIC_URL}/images/...`——當 `S3_PUBLIC_URL` 本身帶了路徑（本機 MinIO path-style 慣例
  一定要帶 bucket 名稱，`.env.example` 給的範例值正是 `http://localhost:9000/sharegood`），
  實際路徑就變成 `/sharegood/images/...`，跟寫死的 `/images/**` 對不起來，`next/image` 直接
  判定這個 host 沒被允許，回 500。因為這個 worktree原本 `.env` 完全沒設 `S3_PUBLIC_URL`
  （另一個環境缺陷，見 PR 說明），這個 pathname bug 一直沒被本機測試踩到，直到補上
  `.env` 才浮現——這是 M0 就存在的既有 bug，跟 M3 改動無關，只是剛好在這裡第一次被本機驗證
  流程踩到。
- 修法：`next.config.ts` 的 `pathname` 改成把 `s3PublicUrl.pathname` 併進去
  （`` `${s3PublicUrl.pathname === "/" ? "" : s3PublicUrl.pathname}/images/**` ``），
  同時涵蓋「`S3_PUBLIC_URL` 純 host」與「`S3_PUBLIC_URL` 帶 bucket 路徑」兩種情境。
- 引申規則：本機第一次要驗證任何「有圖片的頁面」之前，先確認 worktree 的 `.env` 裡
  `S3_ENDPOINT`／`S3_PUBLIC_URL` 等變數是否存在（`.env` 是 gitignored，各 worktree
  互不共用，新 worktree 很可能整組 S3 變數是空的）；補上之後如果還是 500，先看伺服器
  log 的實際錯誤訊息（不要只看 status code），`next/image` 的 remotePatterns 不比對成功
  時錯誤訊息很明確會講「hostname is not configured」。
