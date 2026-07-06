import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

// ==========================================================================
// 公開 GET 端點的 IP 級節流（P1，補既有 rate-limit.ts 只管登入 mutation 的缺口）。
//
// 為什麼是「記憶體固定時窗」而不是 DB-based：既有 src/lib/rate-limit.ts 對 mutation 用
// 「COUNT 既有表在時窗內的列數」——那些動作本來就會寫入一列（Item／ClaimComment…），
// COUNT 幾乎零額外成本。但公開列表 GET 不會產生任何列，要走 DB-based 就得「每個匿名請求
// 都先 INSERT 一列再 COUNT」——這等於把「要防的高流量匿名 GET」變成「等量的 DB 寫入」，
// 反而放大了你想擋掉的 DoS，且需要新增資料表（本專案 schema 自 PR #36 起刻意凍結）。
// 因此這裡用行程內記憶體固定時窗計數：對公開 GET 的粗粒度濫用防護足夠、零 DB 成本。
//
// 已知取捨：計數只存在單一 web 行程的記憶體，多實例部署時各實例各自計數、重啟即歸零。
// 對「保守的濫用防護」而言可接受（Zeabur 目前單一 web 服務）。未來若水平擴展到多實例、
// 需要跨實例一致的限流，把 checkIpThrottle 的實作換成 Redis 令牌桶即可，呼叫端不必改
// （比照 rate-limit.ts 註解裡「之後換 Redis 把實作換掉、呼叫端不變」的既定方向）。
//
// 隱私：key 只存 IP 的 SHA-256 雜湊，不存明文 IP（即使記憶體被 dump 也讀不回原始 IP）。
// ==========================================================================

export type IpThrottleAction = "items_list";

/** 各動作的時窗與上限，集中管理（比照 rate-limit.ts / contribution.ts 慣例）。 */
export const IP_THROTTLE_LIMITS: Record<IpThrottleAction, { windowMs: number; max: number }> = {
  // 公開物品列表 GET /api/items：每 IP 每分鐘 60 次。正常瀏覽（換頁／篩選）遠低於此，
  // 只擋機器人式的高速抓取。
  items_list: { windowMs: 60_000, max: 60 },
};

const IP_HASH_SALT = "sharegood-ip-throttle-v1";

/**
 * 取請求端 IP。Next.js 16 已移除 NextRequest.ip／geo（見官方 next-request 文件，此版本
 * 型別上不存在 .ip），官方建議改讀反向代理帶進來的標頭。Zeabur 在最前面的反向代理會設
 * X-Forwarded-For（逗號分隔，最左邊是原始 client），取最左一跳；退而求其次讀 X-Real-IP。
 *
 * 兩者皆無時回傳 null，呼叫端應「跳過節流」而不是把所有無標頭請求塞進同一個共用 bucket：
 * 正式站一律經 Zeabur 反向代理、XFF 必定存在，回 null 只會發生在「未經代理直打 origin」
 * （非公開濫用向量）或本機測試直連，這些情境不值得用一個會互相汙染的共用 bucket 去限流。
 */
export function getClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`${IP_HASH_SALT}:${ip}`).digest("hex");
}

type Bucket = { count: number; windowStart: number };

// key = `${action}:${ipHash}`。行程內共用。
const buckets = new Map<string, Bucket>();

// 記憶體上界保護：超過這個大小就順手清掉已過期的 bucket。台灣縣市級流量下正常遠不會到，
// 這是防「大量不同來源 IP 短時間打進來」把 Map 撐爆的保險。
const MAX_BUCKETS = 50_000;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    // 用最長的時窗當清理門檻即可（目前各動作時窗相同）。
    if (now - bucket.windowStart >= 60_000) buckets.delete(key);
  }
}

export class IpThrottleExceededError extends Error {}

/**
 * 檢查某 IP 對某動作是否超過時窗上限，超過就丟 IpThrottleExceededError（呼叫端 catch
 * 起來回 429）。沒超過就記一次並 resolve。純同步、零 DB 呼叫。
 *
 * @param now 供測試注入固定時間；預設真實時間。
 */
export function checkIpThrottle(
  ip: string,
  action: IpThrottleAction,
  now: number = Date.now(),
): void {
  const { windowMs, max } = IP_THROTTLE_LIMITS[action];
  const key = `${action}:${hashIp(ip)}`;

  if (buckets.size > MAX_BUCKETS) sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  bucket.count += 1;
  if (bucket.count > max) {
    throw new IpThrottleExceededError("請求過於頻繁，請稍後再試");
  }
}

/** 僅供測試：清空計數狀態，讓各測試案例互不干擾。 */
export function __resetIpThrottleForTests(): void {
  buckets.clear();
}
