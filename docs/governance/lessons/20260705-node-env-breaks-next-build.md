# 本環境 shell 預設 NODE_ENV=development，會讓 `next build` 崩潰——build 一律強制 NODE_ENV=production

- 日期：2026-07-05
- 情境：M0 首次跑 `npm run build`（Next.js 16, Turbopack）
- 症狀：`Error occurred prerendering page "/_not-found"`、
  `TypeError: Cannot read properties of null (reading 'useContext')`，
  伴隨大量 `unique "key" prop` 警告；且 build 開頭有
  `⚠ You are using a non-standard "NODE_ENV" value` 警告。
- 原因：這個遠端環境的 shell 預設匯出 `NODE_ENV=development`。`next build` 需要
  production 模式，被外部 NODE_ENV 覆蓋後 React 混用 dev/prod 版本導致 prerender 崩潰。
- 修法：`package.json` 的 build script 已寫死 `NODE_ENV=production next build`（repo 內已修，
  不需再處理）。在本環境手動跑任何 production 指令時，記得前綴 `NODE_ENV=production`。
- 引申規則：看到 useContext null / hydration 類的離奇 React 錯誤，先檢查
  `echo $NODE_ENV`，再去懷疑程式碼。
