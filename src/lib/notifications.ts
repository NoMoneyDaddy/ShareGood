import type { Notification, NotificationType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

// M4 通知強化設定值（master-plan §9）：集中放這裡，之後要調整不用滿專案找魔術數字。
export const NOTIFICATION_MERGE_WINDOW_MINUTES = 30;
export const DAILY_EXTERNAL_NOTIFICATION_LIMIT = 20;

const MERGE_WINDOW_MS = NOTIFICATION_MERGE_WINDOW_MINUTES * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台灣不實施日光節約時間，固定 UTC+8。

// 只要求呼叫端提供 `notification` model 這個介面，這樣同一支 helper 才能同時在
// 「一般 db」跟「$transaction 內的 tx」兩種情境下重用（兩者的型別都滿足這個介面）。
type NotificationClient = {
  notification: Pick<Prisma.NotificationDelegate, "findFirst" | "update" | "create">;
};

type NotificationPayload = Prisma.InputJsonObject;

function asPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/** 從既有通知的 payload 讀出目前累積的合併筆數（沒有這個欄位就當作 1）。 */
export function mergedCountOf(payload: unknown): number {
  const value = asPayloadRecord(payload).mergedCount;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * 建立通知，或在 30 分鐘窗口內合併進「同一使用者、同一物品、同一 type」的既有未讀通知。
 *
 * 設計：
 * - 只有 payload 帶字串 `itemId` 才做合併比對（沒有 itemId 就無從判斷「同一物品」，直接新增）。
 * - 只跟「未讀」的通知合併：使用者已經讀過的通知代表已經看過那個時間點的事件，新事件應該
 *   讓使用者看到一筆新的未讀通知，而不是偷偷把已讀通知改回未讀、內容卻是新事件。
 * - 找到可合併對象時：payload 換成最新一次呼叫的內容（+ 累加後的 mergedCount），並把
 *   `createdAt` 推進到現在——效果是「這波事件只要間隔不超過 30 分鐘就會一直併到同一筆」，
 *   直到中間空窗超過 30 分鐘才會另外開一筆新通知。呼叫端（`describeNotification` 等顯示邏輯）
 *   可以用 `mergedCountOf` 讀出筆數，組出「有 3 則新留言」這類聚合文字。
 * - `client` 參數接受 `db` 或 `$transaction` 給的 `tx`，讓合併判斷與寫入可以跟呼叫端原本的
 *   atomic 操作包在同一個 transaction 裡（例如認領搶佔、交接完成那些既有的原子分支）。
 *
 * 已知限制（多個 bot review 都指出過，記錄下來避免以為是疏漏）：`findFirst` 到
 * `update`/`create` 之間不是原子操作，同一個 (userId, type, itemId) 在極短時間內被
 * 兩個併發請求同時觸發時，理論上可能各自建立一筆而不是合併成一筆。目前沒有可以拿來做
 * `INSERT ... ON CONFLICT` 的 unique constraint（要動 schema，M2/M3/M4 schema 已凍結），
 * 且在現階段的流量下發生機率極低、後果僅止於通知筆數/文案略有落差，非資料損毀，暫不處理；
 * 若未來要收斂，方向是幫 (userId, type, itemId, 是否未讀) 這個合併鍵加 unique constraint
 * 並改寫成真正的 upsert，或在 transaction 內用 `pg_advisory_xact_lock` 鎖住這個組合
 * （見 `POST /api/admin/user-restrictions` 已經用同一招處理過類似的重複建立問題）。
 */
export async function createOrMergeNotification(
  client: NotificationClient,
  params: { userId: string; type: NotificationType; payload: NotificationPayload },
): Promise<Notification> {
  const { userId, type, payload } = params;
  const itemId = typeof payload.itemId === "string" ? payload.itemId : null;

  if (itemId) {
    const windowStart = new Date(Date.now() - MERGE_WINDOW_MS);
    const existing = await client.notification.findFirst({
      where: {
        userId,
        type,
        readAt: null,
        createdAt: { gte: windowStart },
        payload: { path: ["itemId"], equals: itemId },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const nextCount = mergedCountOf(existing.payload) + 1;
      return client.notification.update({
        where: { id: existing.id },
        data: {
          payload: { ...payload, mergedCount: nextCount },
          createdAt: new Date(),
        },
      });
    }
  }

  return client.notification.create({
    data: {
      userId,
      type,
      payload: itemId ? { ...payload, mergedCount: 1 } : payload,
    },
  });
}

/** 台北曆日（UTC+8，無日光節約）當天 00:00 對應的 UTC 時間點，不依賴 process 本身的時區設定。 */
function startOfTaipeiDay(date: Date): Date {
  const taipeiMs = date.getTime() + TAIPEI_OFFSET_MS;
  const taipeiDate = new Date(taipeiMs);
  const taipeiMidnightUtcMs = Date.UTC(
    taipeiDate.getUTCFullYear(),
    taipeiDate.getUTCMonth(),
    taipeiDate.getUTCDate(),
  );
  return new Date(taipeiMidnightUtcMs - TAIPEI_OFFSET_MS);
}

type DeliveryClient = {
  notificationDelivery: {
    count: (args: { where: Prisma.NotificationDeliveryWhereInput }) => Promise<number>;
  };
};

/**
 * 每人每日外部通知上限（master-plan §9，預設 20 筆，見 `DAILY_EXTERNAL_NOTIFICATION_LIMIT`）。
 *
 * 判斷依據：`NotificationDelivery`（透過 `Notification.userId` 關聯回使用者）今天
 * （台北曆日）狀態為 `sent` 或 `pending` 的筆數是否 `>= 上限`。之所以把 `pending` 也算進去，
 * 是因為呼叫這支 helper 的時機通常是「準備要送」之前，此時當次的 delivery 列還沒建立，
 * 用既有的 pending／sent 筆數就能反映「今天已經用掉的外送額度」；`failed` 不計入，因為
 * 送達失敗的那則通知使用者實際上沒收到，不應該佔用他的每日額度。
 *
 * 回傳 false 代表「已達上限，這次不要外送」——只影響外部通知（Telegram 等），站內通知
 * （`Notification` 本身）不受影響，一律照常寫入。這支 helper 本身不寄送任何東西，只回答
 * 「現在可不可以送」，實際發送邏輯（Telegram 那支任務）呼叫前應該先檢查這裡。
 */
export async function shouldSendExternalNotification(
  userId: string,
  opts: { client?: DeliveryClient; now?: Date; limit?: number } = {},
): Promise<boolean> {
  const client = opts.client ?? db;
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DAILY_EXTERNAL_NOTIFICATION_LIMIT;

  const todayStart = startOfTaipeiDay(now);

  const sentOrPendingToday = await client.notificationDelivery.count({
    where: {
      status: { in: ["sent", "pending"] },
      createdAt: { gte: todayStart },
      notification: { userId },
    },
  });

  return sentOrPendingToday < limit;
}
