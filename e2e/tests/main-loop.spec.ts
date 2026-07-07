import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE_NAME } from "../support/constants";

// M1 主迴路 E2E：「A 上架 → B 留言 → A 接受（先到先得自動接受）→ 私訊 → 雙方標記完成 → B 感謝」。
//
// 登入方式說明：這個專案的 session 策略是 Auth.js database session（見 src/auth.ts），
// 沒有另外做測試專用登入端點；本機環境也沒有設定 Google OAuth 憑證。測試資料的建立/清除
// （見 e2e/fixtures/setup-main-loop.ts、cleanup-users.ts）直接在 sessions 資料表插入一筆
// 有效 session，再把 session token 當成 cookie 帶進真的瀏覽器 context，效果等同「已經用
// Google 登入過」——這是 Auth.js database session 策略下標準且乾淨的測試登入方式，不是
// 繞過權限檢查。這兩支 fixture 腳本用 child_process 起獨立的 `npx tsx` process 執行，
// 不在這個 spec 檔裡直接 import：Playwright Test 的 TS 轉譯器不支援 Prisma 7 產生的
// client（用了 ESM-only 的 `import.meta`），直接 import 會炸掉（見 git log 除錯過程）。
//
// 「A 上架」這一步改用直接呼叫 POST /api/items（仍是真的 API、真的驗證邏輯，只是不
// 透過瀏覽器的檔案上傳表單）：本機環境沒有配置 MinIO/S3，瀏覽器走真實 UI 上傳圖片會
// 打 /api/uploads 失敗。上架之後的每一步（留言、交接、私訊、雙方標記完成、感謝）都是
// 真的在瀏覽器裡點擊/輸入完成，不是 API 呼叫。
test.describe.configure({ mode: "serial" });

type TestUser = { id: string; email: string; nickname: string; sessionToken: string };

const REPO_ROOT = path.resolve(__dirname, "../..");

let owner: TestUser;
let claimer: TestUser;
let itemId: string;

test.beforeAll(() => {
  const stdout = execFileSync("npx", ["tsx", "e2e/fixtures/setup-main-loop.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  const parsed = JSON.parse(stdout) as { owner: TestUser; claimer: TestUser; itemId: string };
  owner = parsed.owner;
  claimer = parsed.claimer;
  itemId = parsed.itemId;
});

test.afterAll(() => {
  execFileSync("npx", ["tsx", "e2e/fixtures/cleanup-users.ts", owner.id, claimer.id], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
});

async function loginAs(page: import("@playwright/test").Page, user: TestUser) {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: user.sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("A 上架 → B 留言 → 自動接受 → 私訊 → 雙方完成 → B 感謝", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const claimerContext = await browser.newContext();
  // M11 初次導覽會在登入後首訪自動彈出（localStorage 無 tour_done 時），浮層會攔截
  // 主迴路的點擊；這支測試專注交付流程本身，預先標記導覽已看過。
  await ownerContext.addInitScript(() => window.localStorage.setItem("tour_done", "true"));
  await claimerContext.addInitScript(() => window.localStorage.setItem("tour_done", "true"));
  const ownerPage = await ownerContext.newPage();
  const claimerPage = await claimerContext.newPage();
  await loginAs(ownerPage, owner);
  await loginAs(claimerPage, claimer);

  await test.step("B 造訪物品詳情頁，看得到剛上架的物品（SSR）", async () => {
    await claimerPage.goto(`/items/${itemId}`);
    await expect(claimerPage.getByRole("heading", { name: "主迴路 E2E 測試物品" })).toBeVisible();
  });

  await test.step("B 留言，先到先得自動接受", async () => {
    await claimerPage
      .getByPlaceholder("留言表達你想要這個好物（第一則留言會自動被接受）")
      .fill("我想要這個！");
    await claimerPage.getByRole("button", { name: "送出留言" }).click();
    await expect(claimerPage.getByText("已被認領")).toBeVisible();
  });

  await test.step("A 重新整理後看到物品已被認領，開始交接", async () => {
    await ownerPage.goto(`/items/${itemId}`);
    await expect(ownerPage.getByText("前往交接")).toBeVisible();
    await ownerPage.getByRole("button", { name: "前往交接" }).click();
    await expect(ownerPage).toHaveURL(/\/conversations\//);
  });

  await test.step("A 在私訊裡打招呼", async () => {
    await ownerPage.locator("#conversation-message").fill("你好，我們約晚上七點交接");
    await ownerPage.getByRole("button", { name: "送出訊息" }).click();
    await expect(ownerPage.getByText("你好，我們約晚上七點交接")).toBeVisible();
  });

  await test.step("B 重新整理物品頁，前往私訊回覆", async () => {
    await claimerPage.goto(`/items/${itemId}`);
    await expect(claimerPage.getByRole("link", { name: "前往私訊" })).toBeVisible();
    await claimerPage.getByRole("link", { name: "前往私訊" }).click();
    await expect(claimerPage.getByText("你好，我們約晚上七點交接")).toBeVisible();
    await claimerPage.locator("#conversation-message").fill("好的，晚上見！");
    await claimerPage.getByRole("button", { name: "送出訊息" }).click();
    await expect(claimerPage.getByText("好的，晚上見！")).toBeVisible();
  });

  await test.step("A 標記完成（只有 A 確認，還要等 B 也確認才會真的變 completed）", async () => {
    await ownerPage.goto(`/items/${itemId}`);
    const [response] = await Promise.all([
      ownerPage.waitForResponse(
        (res) => res.url().includes("/api/handover/") && res.url().endsWith("/complete"),
      ),
      ownerPage.getByRole("button", { name: "標記完成" }).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "pending" }); // 只有一方確認，還不是 completed
  });

  await test.step("B 標記完成，物品轉為已完成分享並留感謝", async () => {
    await claimerPage.goto(`/items/${itemId}`);
    await claimerPage.getByRole("button", { name: "標記完成" }).click();
    await expect(claimerPage.getByText("已完成分享")).toBeVisible();

    await claimerPage.getByLabel("感謝留言").fill("謝謝你的分享，東西很棒！");
    await claimerPage.getByRole("button", { name: "送出感謝" }).click();
    await expect(claimerPage.getByText("謝謝你的分享，東西很棒！")).toBeVisible();
  });

  await test.step("A 重新整理，也看得到 B 的感謝留言", async () => {
    // 本機 Turbopack dev server 在冷啟動後第一次打到某條動態路由時，編譯＋渲染偶爾會
    // 比預設 5s 斷言逾時還慢（純 dev-mode 現象，`next build`/`next start` 的正式產物
    // 沒有這個問題）；這裡改成「重新整理＋等久一點」，比單純拉長單一斷言逾時更貼近
    // 真實使用者「重新整理應該看得到」的行為，也順便驗證了 revalidate 是可重試、
    // 最終一致的，不是曇花一現。
    await expect(async () => {
      await ownerPage.goto(`/items/${itemId}`);
      await expect(ownerPage.getByText("謝謝你的分享，東西很棒！")).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20_000 });
  });

  await ownerContext.close();
  await claimerContext.close();
});
