// M10 批次 1 驗收用暫時腳本：登入測試帳號＋建幾筆資料，對代表頁面在 375/1280 兩種寬度
// 截前後對照圖（本次是「後」，殼層修好之後的樣子），並截一組深色模式（colorScheme: dark）
// 驗證品牌 token 的 .dark/@media 覆寫有生效。跑完會清掉這次建立的測試資料。
// 用法：dev server 先跑在 :3481，然後 `npx tsx scripts/shell-screenshots.ts`。
import "dotenv/config"; // 讀 .env 的 DATABASE_URL（src/lib/db.ts 需要），tsx 不會自動載入
import { chromium } from "@playwright/test";
import { cleanupTestData, createTestUser, sessionCookie } from "../e2e/support/auth";
import { db } from "../e2e/support/db";

const BASE_URL = "http://localhost:3481";
const SHOT_DIR = "docs/research/2026-07-07-frontend-refactor/screenshots";

async function main() {
  const city = await db.city.findFirst({ select: { id: true } });
  const category = await db.category.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!city || !category) throw new Error("seed 資料不完整：缺 city 或 category");

  const user = await createTestUser({ label: "shell-shot", cityId: city.id });

  // 建一筆物品讓 u/[userId] 個人頁與 /items 有東西可看，也讓 /me/wallet 有資料可截（如果有券）。
  const item = await db.item.create({
    data: {
      ownerId: user.id,
      title: "[shell-shot] 測試用不到的桌燈",
      description: "殼層截圖驗收用的測試物品，截圖後會被清除。",
      cityId: city.id,
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
    },
  });

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addCookies([sessionCookie(user, { domain: "localhost" })]);
    const page = await context.newPage();

    const mobileTargets: Array<[string, string]> = [
      ["/items/new", "shell-items-new"],
      ["/conversations", "shell-conversations"],
      ["/notifications", "shell-notifications"],
      ["/me/wallet", "shell-me-wallet"],
      ["/deal-infos", "shell-deal-infos"],
      [`/u/${user.id}`, "shell-u-userid"],
    ];

    for (const [path, name] of mobileTargets) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${SHOT_DIR}/${name}-mobile-375.png` });
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    for (const [path, name] of mobileTargets) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${SHOT_DIR}/${name}-desktop-1280.png` });
    }

    await context.close();

    // 深色模式：colorScheme: "dark" 觸發 prefers-color-scheme media query（不需要
    // 任何 .dark class／provider），驗證品牌 token 的深色覆寫實際生效。
    const darkContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: "dark",
    });
    const darkPage = await darkContext.newPage();
    await darkPage.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await darkPage.screenshot({ path: `${SHOT_DIR}/shell-dark-home-1280.png` });
    await darkPage.goto(`${BASE_URL}/items`, { waitUntil: "networkidle" });
    await darkPage.screenshot({ path: `${SHOT_DIR}/shell-dark-items-1280.png` });
    await darkContext.close();

    console.log("截圖完成");
  } finally {
    await browser.close();
    await db.item.delete({ where: { id: item.id } }).catch(() => {});
    await cleanupTestData([user.id]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
