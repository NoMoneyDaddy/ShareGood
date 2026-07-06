import "dotenv/config";
import { createTestUser } from "../support/auth";
import { createPublishedItem } from "../support/items";

// Playwright 的 TS 轉譯器不支援 Prisma 7 產生的 client（用了 ESM-only 的
// `import.meta`），main-loop.spec.ts 不能直接 import 會拉到 db.ts 的模組。這支腳本
// 用 `npx tsx` 跑在獨立的 Node process，把資料庫操作結果用 JSON 印到 stdout，
// spec 檔用 child_process 呼叫、讀 stdout 就好（見 e2e/tests/main-loop.spec.ts）。
async function main() {
  const owner = await createTestUser({ label: "loop-owner" });
  const claimer = await createTestUser({ label: "loop-claimer" });
  const itemId = await createPublishedItem(owner, { title: "主迴路 E2E 測試物品" });
  process.stdout.write(JSON.stringify({ owner, claimer, itemId }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
