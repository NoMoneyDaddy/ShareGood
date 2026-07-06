import type { Instrumentation } from "next";

// master-plan §8a 交付內容 3：`error_logs` 記錄「API 未捕捉例外」。
//
// 選型：Next.js `instrumentation.ts` 的 `onRequestError` hook（v15.0.0 起穩定，本專案
// Next 16.2.10，見 node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// instrumentation.md）。這個 hook 會在 Route Handler／Server Component／Server Action
// 丟出「真的沒被 catch」的例外時自動觸發，帶有 routePath（已正規化、不含動態 id 的實際值，
// 例如 "/app/api/items/[id]/claims/route"）與 routeType 等 context。用這個 hook 而不是
// 手動在每支既有 API route 裡加 try/catch，可以一次性涵蓋全站所有 route，不需要碰
// 幾十支既有 route 檔案；本來就有 try/catch 自行組成結構化錯誤回應（`jsonError`）的情境
// 屬於「預期內的業務錯誤」，不會走到這裡，符合規格「未捕捉例外」的定義。
//
// Edge runtime 不支援 Prisma（node-postgres driver），這裡動態 import 只在 Node runtime
// 執行，避免把 Prisma 相關程式碼打包進 Edge bundle。
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { logError, normalizeRoutePath, classifyErrorSource } = await import("@/lib/error-log");
    const normalizedRoute = normalizeRoutePath(context.routePath);
    await logError({
      source: classifyErrorSource(normalizedRoute),
      routeOrJob: normalizedRoute,
      error,
      // 只記路徑與方法，不記 headers（可能含 Authorization: Bearer <CRON_SECRET> 等秘密）
      // 也不記 body（可能含使用者輸入的個資），符合「禁止塞入敏感個資」的規則。
      context: { path: request.path, method: request.method, routeType: context.routeType },
    });
  } catch {
    // 記錄本身失敗不能讓例外處理鏈路跟著壞掉，吞掉即可。
  }
};
