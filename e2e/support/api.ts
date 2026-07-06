import type { TestUser } from "./auth";
import { sessionCookieHeader } from "./auth";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3113";

type CallOpts = {
  method?: string;
  user?: TestUser | null;
  body?: unknown;
};

/** 打正在跑的測試伺服器，選擇性帶登入 cookie。回傳 { status, json }。 */
export async function api(path: string, opts: CallOpts = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.user) headers.cookie = sessionCookieHeader(opts.user);

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
