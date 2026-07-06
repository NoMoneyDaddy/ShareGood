import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SLOW_QUERY_THRESHOLD_MS } from "@/lib/ops-config";

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
  prismaExtended?: PrismaClient;
};

function createBaseClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

// 未套用查詢耗時量測 extension 的原始 client，只給下面 extension 內部寫
// `PerformanceMetric` 用（見下方說明），一般業務程式碼不應該直接 import 這個。
const base = globalForPrisma.prismaBase ?? createBaseClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = base;

function normalizeQueryLabel(model: string | undefined, operation: string): string {
  return model ? `${model}.${operation}` : `raw.${operation}`;
}

// 慢查詢紀錄擷取機制（master-plan §8a 交付內容 3）：用 Prisma Client Extension 的
// query 元件（`$extends` 而非 `$use` middleware——`$use` 已在 Prisma v6.14.0 移除，
// 本專案用 Prisma 7，`$extends` 是現行推薦做法，詳見 PR 說明的官方文件查證來源），
// 量測每一次 ORM 查詢的 wall time，全量記錄不設門檻（見規格「取樣範圍」）。
//
// 這裡刻意用上面「未擴充」的 `base` client 寫入 `PerformanceMetric`，而不是這支
// extension 包出來的 `db` 本身：如果用 `db.performanceMetric.create(...)`，這個
// create 呼叫會被同一個 extension 攔截、量測完又再寫一筆 `PerformanceMetric`，形成
// 無窮迴圈（每次量測動作本身又觸發下一次量測）。用 `base` 繞過 extension 就沒有這個
// 問題——`PerformanceMetric`／`ErrorLog` 這兩張表本身的寫入不需要被自己量測。
function extendWithQueryMetrics(client: PrismaClient) {
  return client.$extends({
    name: "query-performance-metrics",
    query: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        try {
          return await query(args);
        } finally {
          const durationMs = Math.round(performance.now() - start);
          const label = normalizeQueryLabel(model, operation);
          base.performanceMetric
            .create({
              data: {
                metricType: "db_query",
                label,
                durationMs,
                isSlow: durationMs > SLOW_QUERY_THRESHOLD_MS,
              },
            })
            .catch(() => {
              // 量測寫入失敗不能拖累原查詢，吞掉即可（例如 DB 瞬斷）。
            });
        }
      },
    },
  });
}

// `$extends()` 回傳的型別（`DynamicClientExtensionThis<...>`）雖然執行期跟 `PrismaClient`
// 完全相容（這裡只加了 query 側寫，沒有新增 model／client 層級方法），但在型別層面不是
// `PrismaClient` 的結構化子型別——會讓既有程式碼裡「參數型別寫死 `PrismaClient` 或
// `Prisma.TransactionClient`」的地方（例如 `src/lib/notifications.ts` 的
// `NotificationClient` 介面、各 job route 傳給 `db.$transaction` 的 callback）全部編譯失敗。
// 這裡刻意轉型回 `PrismaClient`，讓 `db` 對外的型別跟擴充前完全一樣，全站不必為了這個
// 量測 extension 改寫任何既有型別標註。
export const db = (globalForPrisma.prismaExtended ?? extendWithQueryMetrics(base)) as PrismaClient;
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaExtended = db;

/**
 * 繞過查詢耗時量測 extension 的原始 client。目前只給 `PerformanceMetric` 自己的
 * 寫入用（見上方說明），避免無窮迴圈；一般業務程式碼一律用 `db`，不要 import 這個。
 */
export const rawDb = base;
