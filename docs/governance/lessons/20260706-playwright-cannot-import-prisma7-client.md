# Playwright Test 的 TS 轉譯器不能直接 `import` 會拉到 Prisma 7 產生的 client（`import.meta` 語法炸掉）

- 日期：2026-07-06
- 情境：M1 E2E（`feat/m1-e2e-tests`）寫 Playwright 瀏覽器測試，想比照 Vitest 整合測試那樣，直接
  `import { createTestUser } from "../support/auth"` 來建立測試帳號（`support/auth.ts` 會拉
  `support/db.ts` → `src/lib/db.ts` → `@/generated/prisma/client`）。
- 症狀：`npx playwright test` 直接噴 `SyntaxError: Cannot use 'import.meta' outside a module` /
  `Cannot find module`，且訊息指到 Prisma 產生的 `src/generated/prisma/client.ts`，不是我們自己
  寫的程式碼。Vitest（Vite 底層，原生 ESM）完全沒這個問題，一開始以為是路徑/tsconfig alias 設錯。
- 真正原因：Prisma 7 的 `prisma-client` generator 產生的 client 用了 ESM-only 的 `import.meta`
  語法；Playwright Test 自己的 TS 轉譯管線（不是 Vite，是它自帶的 esbuild-based 轉譯）預設轉成
  CJS，處理不了這種語法。這不是我們專案的 bug，是 Playwright Test runner 對這類 ESM-only 產生碼
  的已知限制。
- 修法：Playwright 的 spec 檔完全不 import 任何會碰到 db 的模組；資料庫相關的準備／清除邏輯
  抽成獨立的 `npx tsx` 腳本（`e2e/fixtures/setup-main-loop.ts`、`cleanup-users.ts`），spec 檔用
  `node:child_process` 的 `execFileSync` 呼叫這些腳本、用 stdout 傳 JSON 交換資料。cookie 名稱
  這種不需要 db 的常數，獨立拆到 `e2e/support/constants.ts`（零 import），spec 檔可以放心
  `import`。
- 引申規則：專案換到 Prisma 7（`prisma-client` generator）之後，任何**不是**由 Vite/Next.js
  bundler 處理、而是自帶簡化版 TS 轉譯器的工具（Playwright Test 是目前遇到的一個例子），要先假設
  它可能不支援 Prisma 產生碼裡的 `import.meta`；解法一律是「讓那個工具的程式碼完全不 import
  db」，不要嘗試改 tsconfig/加 polyfill 去餵它 ESM，那條路更貴。
