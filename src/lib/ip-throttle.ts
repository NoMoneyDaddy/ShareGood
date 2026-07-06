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
 * 型別上不存在 .ip），官方建議改讀反向代理帶進來的標頭。
 *
 * X-Forwarded-For 取「最右一跳」而非最左：XFF 是客戶端可自行帶入任意值的請求標頭，最左邊
 * 的值來源可以是偽造的（客戶端自己塞一個假 XFF 進來，最左跳就是攻擊者想讓你相信的任意
 * IP，等於繞過整個節流）。在「單層受信代理」假設下（Zeabur 目前架構：客戶端 → Zeabur
 * 反向代理 → 本服務，只有一層代理），代理只會把自己觀察到的真實來源位址「附加」在既有
 * XFF 值之後，因此最右一跳必定是代理親眼看到、客戶端無法偽造的真實 client IP。
 * 兩者皆無或 XFF 為空時退而求其次讀 X-Real-IP（Zeabur 是否會覆寫 X-Real-IP 未查證，故
 * 僅作次要 fallback，不當首選）。
 *
 * 未來若架構加上 CDN 或多層代理（可信任跳數 > 1），這裡的「最右一跳＝真實 IP」假設就會
 * failed——需改成依設定的可信任代理跳數，從右邊數第 N 個位置取值。
 *
 * 兩者皆無時回傳 null，呼叫端應「跳過節流」而不是把所有無標頭請求塞進同一個共用 bucket：
 * 正式站一律經 Zeabur 反向代理、XFF 必定存在，回 null 只會發生在「未經代理直打 origin」
 * （非公開濫用向量）或本機測試直連，這些情境不值得用一個會互相汙染的共用 bucket 去限流。
 */
export function getClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const last = hops.length > 0 ? hops[hops.length - 1] : undefined;
    if (last) return last;
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

// 清掃節流：一旦超過 MAX_BUCKETS，若每個請求都同步遍歷整個 Map 找過期項目，會在高流量時
// 造成 event loop 阻塞（O(n) 掃描疊加在每個請求路徑上）。改成「每 10 秒最多清一次」：
// 兩次清掃之間即使持續超過上限也直接略過本次清掃，代價是短暫超出 MAX_BUCKETS（記憶體上界
// 保護本來就是保守的軟上限，不是硬性配額），換取「清掃頻率與請求量脫鉤」。
const SWEEP_INTERVAL_MS = 10_000;
let lastSweepTime = 0;

function sweepExpired(now: number): void {
  if (now - lastSweepTime < SWEEP_INTERVAL_MS) return;
  lastSweepTime = now;
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
