import "dotenv/config";
import { createTestUser } from "../support/auth";
import { db } from "../support/db";

// UX 走查專用：只建立使用者（不預先建物品，物品要靠瀏覽器實際操作上架），
// 印出 JSON 給外部 Playwright 腳本讀。
async function main() {
  try {
    const userA = await createTestUser({ label: "walk-a" });
    const userB = await createTestUser({ label: "walk-b" });
    const userC = await createTestUser({ label: "walk-c" });
    const [city] = await db.city.findMany({ orderBy: { sortOrder: "asc" }, take: 1 });
    process.stdout.write(JSON.stringify({ userA, userB, userC, cityId: city?.id ?? null }));
  } finally {
    await db.$disconnect();
  }
}

// 不手動 process.exit(0)：stdout 接到 pipe 時寫入是非同步的，強制退出可能截斷 JSON；
// 連線池斷開後 event loop 自然結束。錯誤路徑用 exitCode 讓輸出寫完再退出。
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
