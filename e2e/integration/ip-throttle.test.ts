import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIpThrottleForTests,
  checkIpThrottle,
  getClientIp,
  IP_THROTTLE_LIMITS,
  IpThrottleExceededError,
} from "@/lib/ip-throttle";
import { api } from "../support/api";

const LIMIT = IP_THROTTLE_LIMITS.items_list.max;

describe("公開 GET 端點 IP 級節流", () => {
  beforeEach(() => {
    __resetIpThrottleForTests();
  });

  it("getClientIp：優先取 X-Forwarded-For 最右一跳（單層受信代理實際附加的真實 IP），其次 X-Real-IP", () => {
    const xff = {
      headers: { get: (k: string) => (k === "x-forwarded-for" ? "203.0.113.1, 10.0.0.1" : null) },
    };
    // 最右一跳 10.0.0.1 是（單層）受信代理實際觀察到的來源，才是不可偽造的真實 client IP。
    expect(getClientIp(xff as never)).toBe("10.0.0.1");

    const realIp = {
      headers: { get: (k: string) => (k === "x-real-ip" ? "198.51.100.9" : null) },
    };
    expect(getClientIp(realIp as never)).toBe("198.51.100.9");

    const none = { headers: { get: () => null } };
    expect(getClientIp(none as never)).toBeNull();
  });

  it("getClientIp：客戶端偽造左側值時仍取最右真實 IP", () => {
    // 客戶端自己在請求裡塞入的 X-Forwarded-For 值會被代理「附加」在後面，不會覆蓋掉。
    // 攻擊者能控制的只有最左邊（自己塞的假值），代理附加的最右一跳才是無法偽造的真實來源。
    const spoofed = {
      headers: {
        get: (k: string) => (k === "x-forwarded-for" ? "1.2.3.4, 9.9.9.9, 203.0.113.200" : null),
      },
    };
    expect(getClientIp(spoofed as never)).toBe("203.0.113.200");
    expect(getClientIp(spoofed as never)).not.toBe("1.2.3.4");
  });

  it("checkIpThrottle：時窗內未超限不丟，超過上限丟 IpThrottleExceededError", () => {
    const ip = "192.0.2.55";
    for (let i = 0; i < LIMIT; i++) {
      expect(() => checkIpThrottle(ip, "items_list")).not.toThrow();
    }
    expect(() => checkIpThrottle(ip, "items_list")).toThrow(IpThrottleExceededError);
  });

  it("checkIpThrottle：時窗過後計數重置", () => {
    const ip = "192.0.2.66";
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT; i++) checkIpThrottle(ip, "items_list", t0);
    expect(() => checkIpThrottle(ip, "items_list", t0)).toThrow(IpThrottleExceededError);
    // 下一個時窗（+61 秒）：重新計數，不再擋。
    expect(() => checkIpThrottle(ip, "items_list", t0 + 61_000)).not.toThrow();
  });

  it("checkIpThrottle：不同 IP 各自獨立計數", () => {
    const a = "192.0.2.77";
    const b = "192.0.2.88";
    for (let i = 0; i < LIMIT; i++) checkIpThrottle(a, "items_list");
    expect(() => checkIpThrottle(a, "items_list")).toThrow(IpThrottleExceededError);
    // b 沒被 a 影響。
    expect(() => checkIpThrottle(b, "items_list")).not.toThrow();
  });

  it("GET /api/items：同一 IP 超過每分鐘上限回 429", async () => {
    // 用一個獨佔的 X-Forwarded-For，避免與其他測試共用 localhost bucket 互相干擾。
    const ip = "198.51.100.123";
    const headers = { "x-forwarded-for": ip };

    // 前 LIMIT 次不應該是 429。
    let lastOkStatus = 0;
    for (let i = 0; i < LIMIT; i++) {
      const res = await api("/api/items?limit=1", { headers });
      lastOkStatus = res.status;
    }
    expect(lastOkStatus).not.toBe(429);

    // 第 (LIMIT+1) 次：超限，429。
    const over = await api("/api/items?limit=1", { headers });
    expect(over.status).toBe(429);
    expect((over.json as { error?: { code?: string } })?.error?.code).toBe("RATE_LIMITED");
  });
});
