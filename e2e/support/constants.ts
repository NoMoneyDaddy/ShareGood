// 獨立成一個沒有任何其他 import 的檔案：Playwright Test 的 TS 轉譯器不支援 Prisma 7
// 產生的 client（用了 ESM-only 的 `import.meta`），main-loop.spec.ts 不能直接 import
// e2e/support/auth.ts（會拉進 db.ts → @/generated/prisma/client）。cookie 名稱這種
// 不需要碰資料庫的常數獨立放這裡，spec 檔可以安全 import。
export const SESSION_COOKIE_NAME = "authjs.session-token";
