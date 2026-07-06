import "dotenv/config";
import { cleanupTestData } from "../support/auth";

// 搭配 setup-main-loop.ts：同樣的理由（Playwright 轉譯器不支援直接 import db.ts），
// 用法：`npx tsx e2e/fixtures/cleanup-users.ts <userId1> <userId2> ...`
async function main() {
  const userIds = process.argv.slice(2);
  await cleanupTestData(userIds);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
