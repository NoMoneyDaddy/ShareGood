import path from "node:path";
import "dotenv/config"; // 讀 .env 的 DATABASE_URL 等變數（src/lib/db.ts 需要），vitest 不會自動載入
import { defineConfig } from "vitest/config";

// 只給 e2e/integration 的 API 整合測試用（併發／權限邊界／分頁與索引），
// 跟 Playwright 的瀏覽器 E2E（e2e/tests）分開跑。alias 對齊 tsconfig.json 的 `@/*`。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["e2e/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // 這些測試共用同一個資料庫/伺服器，避免互相干擾
  },
});
