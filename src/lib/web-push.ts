import webpush from "web-push";
import { db } from "@/lib/db";

// M6 Web Push（master-plan §6a 交付內容 9）。
//
// 查證來源（使用者特別交代不能憑印象瞎猜，以下皆查過官方文件/套件 README 才寫）：
// - VAPID 設定與 sendNotification 的行為：web-push npm 套件官方 README
//   （https://github.com/web-push-libs/web-push#readme）—— setVapidDetails(subject,
//   publicKey, privateKey) 全域設定一次；sendNotification(pushSubscription, payload,
//   options) 在推播服務回應非 2xx 時是「reject 一個帶 statusCode/headers/body 的物件」，
//   不是回傳失敗值，呼叫端必須 try/catch。
// - PushSubscription 物件格式（endpoint／keys.p256dh／keys.auth）：MDN
//   PushSubscription.toJSON()（https://developer.mozilla.org/docs/Web/API/PushSubscription/toJSON）。
let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export type WebPushPayload = {
  title: string;
  body: string;
  itemUrl: string;
};

export type SendWebPushToUserResult = {
  /** 使用者名下有沒有 isActive 裝置可以嘗試（沒有裝置時呼叫端不應該建立 delivery 失敗紀錄）。 */
  attempted: boolean;
  /** 至少一台裝置成功送達。 */
  anySuccess: boolean;
};

/**
 * 對某使用者名下所有 `isActive=true` 的裝置各發一次 Web Push（master-plan §6a 交付內容 9：
 * 「一個使用者可能有多台裝置各自訂閱；派送時對每個 isActive=true 的裝置各發一次」）。
 *
 * 失效偵測：`webpush.sendNotification` 對非 2xx 回應是 throw，`err.statusCode` 為
 * 404/410（Gone）代表該裝置的推播訂閱已在瀏覽器端失效（使用者關閉通知權限／清除瀏覽器
 * 資料／解除安裝），立刻把該筆 `isActive=false`／`deactivatedAt=now()`；其他錯誤（逾時、
 * 5xx）視為暫時性失敗，只累計 `failureCount`，不動 `isActive`。
 */
export async function sendWebPushToUser(
  userId: string,
  payload: WebPushPayload,
): Promise<SendWebPushToUserResult> {
  const subscriptions = await db.webPushSubscription.findMany({
    where: { userId, isActive: true },
  });
  if (subscriptions.length === 0) {
    // 使用者尚未啟用或裝置皆已失效：跳過這個管道，不建立任何紀錄（比照「使用者沒綁定
    // Telegram 就跳過 Telegram 管道」的既有精神）。
    return { attempted: false, anySuccess: false };
  }

  if (!ensureVapidConfigured()) {
    // VAPID 金鑰未設定（例如本機環境忘了產生）：視為這次派送嘗試過但全部失敗，讓呼叫端
    // 記一筆 failed delivery，方便從紀錄發現環境設定漏掉，而不是靜默跳過。
    return { attempted: true, anySuccess: false };
  }

  const payloadJson = JSON.stringify(payload);

  // 各裝置互相獨立（各自對應不同的 webPushSubscription row，DB 更新也各自只動自己那一筆），
  // 平行送出可以避免使用者多台裝置時，後面的裝置要排隊等前面裝置的網路呼叫做完才收到通知。
  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
          payloadJson,
        );
        await db.webPushSubscription.update({
          where: { id: sub.id },
          data: { lastSuccessAt: new Date(), failureCount: 0 },
        });
        return true;
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.webPushSubscription.update({
            where: { id: sub.id },
            data: { isActive: false, deactivatedAt: new Date() },
          });
        } else {
          await db.webPushSubscription.update({
            where: { id: sub.id },
            data: { failureCount: { increment: 1 }, lastFailureAt: new Date() },
          });
        }
        return false;
      }
    }),
  );

  return { attempted: true, anySuccess: results.some(Boolean) };
}
