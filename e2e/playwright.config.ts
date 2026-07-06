import { defineConfig } from "@playwright/test";

// 這個環境已經預裝 Chromium 給 Playwright 用（PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers），
// 不要跑 `playwright install`；executablePath 直接指向已存在的執行檔。
// 伺服器由外部腳本先啟動（見 docs/plan/master-plan.md M1 驗收操作紀錄），這裡不用
// Playwright 內建的 webServer，避免跟手動管理的測試伺服器 port 打架。
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3113",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: "/opt/pw-browsers/chromium",
    },
  },
});
