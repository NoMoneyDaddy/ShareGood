import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// master-plan §8a 交付內容 3：`error_logs` 記錄「壞事發生」，全量記錄不設門檻。
export type ErrorLogSource = "api" | "background_job" | "webhook";

export interface LogErrorParams {
  source: ErrorLogSource;
  /** 正規化後的 route path（不含動態 id）或 system_jobs.key。 */
  routeOrJob?: string | null;
  error: unknown;
  /** 排查用途的額外資訊（userId、requestId 等）；禁止塞入 §1 列出的敏感個資。 */
  context?: Prisma.InputJsonObject | null;
}

/**
 * 共用的錯誤記錄 helper。刻意「盡力而為」：寫入本身失敗時只吞掉不再往外拋，
 * 避免記錄動作本身掩蓋或取代原始錯誤（呼叫端該做的錯誤處理不受影響）。
 */
export async function logError(params: LogErrorParams): Promise<void> {
  const { source, routeOrJob, error, context } = params;
  const message = error instanceof Error ? error.message : safeStringify(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;

  try {
    await db.errorLog.create({
      data: {
        source,
        routeOrJob: routeOrJob ?? null,
        message,
        stack,
        context: context ?? undefined,
      },
    });
  } catch {
    // 寫入 error_logs 失敗（例如 DB 本身就是壞的）不再往外拋，見上方說明。
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 把 Next.js `instrumentation.ts` 的 `context.routePath`（例如
 * "/app/api/items/[id]/claims/route"）正規化成 `error_logs.routeOrJob` 想要的樣子
 * （例如 "/api/items/[id]/claims"）：去掉 "/app" 前綴與結尾的 "/route"，動態片段
 * 本來就已經是 "[id]" 這種未展開的樣子，不含實際 id，符合規格要求。
 */
export function normalizeRoutePath(routePath: string): string {
  return routePath.replace(/^\/app/, "").replace(/\/route$/, "") || "/";
}

/** 依正規化後的 route path 判斷這支錯誤該歸類的 `error_logs.source`。 */
export function classifyErrorSource(normalizedRoute: string): ErrorLogSource {
  if (normalizedRoute.startsWith("/api/jobs/")) return "background_job";
  if (normalizedRoute.startsWith("/api/telegram/webhook")) return "webhook";
  return "api";
}
