import "dotenv/config";
import { createTestUser } from "../support/auth";
import { db } from "../support/db";

// UX 走查專用：只建立使用者（不預先建物品，物品要靠瀏覽器實際操作上架），
// 印出 JSON 給外部 Playwright 腳本讀。
async function main() {
  const userA = await createTestUser({ label: "walk-a" });
  const userB = await createTestUser({ label: "walk-b" });
  const userC = await createTestUser({ label: "walk-c" });
  const [city] = await db.city.findMany({ orderBy: { sortOrder: "asc" }, take: 1 });
  process.stdout.write(JSON.stringify({ userA, userB, userC, cityId: city?.id ?? null }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
