# 改 `.env` 重啟 `next dev`（Turbopack）後，深層巢狀 API route 變成 Next 自己的 404 頁，看起來像是我們自己的 `jsonError` 404

- 日期：2026-07-06
- 情境：M1 E2E 測試（`feat/m1-e2e-tests`）跑到一半，為了讓 `next/image` 認得測試用的假
  `S3_PUBLIC_URL`，改了 `.env` 後用 `fuser -k <port>/tcp` 殺掉舊 `next dev` 行程、重新
  `npx next dev -p <port>` 起一個新行程（同一個 port、同一份程式碼，只有 `.env` 變了）。
- 症狀：`POST /api/items/[id]/handover/ensure` 這條巢狀動態路由（`items/[id]/handover/ensure/route.ts`）
  重啟後開始穩定回 404，其他同層的路由（`items/[id]/claims`、`items/[id]/direct-shares`）完全正常。
  一開始誤判成「我們自己的 API 邏輯回了 404（item not found）」，因為 HTTP status 就是 404，
  花了好幾輪去查 Prisma 查詢、連線池、資料是否真的寫入，都查不出問題——資料庫裡資料明明都在。
- 真正原因：回應的 `Content-Type` 其實是 `text/html`、body 是 Next.js 內建的
  「404 This page could not be found」整頁 HTML（`curl -i` 才看得出來，光看 status code 看不出來），
  代表這是 **Next.js 框架層級「路由沒找到」**，根本沒進到我們的 `route.ts`。是 Turbopack dev
  server 重啟後，`.next` 目錄裡殘留的舊 route manifest 跟新啟動的行程對不上，導致某條深層巢狀
  路由暫時性地路由失敗（其他路由不受影響，難以預期哪條會中）。
- 修法：`rm -rf .next` 之後乾淨重啟 `next dev`，問題消失，該路由恢復回我們自己的 JSON 404/200。
- 引申規則：**只要改了 `.env`／`next.config.ts` 需要重啟 `next dev`（Turbopack），一律先
  `rm -rf .next` 再啟動**，不要只是 `fuser -k` 殺行程再重開；且往後任何一個 API route
  回 404 時，先用 `curl -i` 確認 `Content-Type` 是不是 `application/json`（我們自己的
  `jsonError` 一定是 JSON），是 `text/html` 就代表根本沒進到程式碼，別去查商業邏輯。
