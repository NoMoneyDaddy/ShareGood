import { NextResponse } from "next/server";

// 全站統一錯誤格式（master-plan §3.2）：{ error: { code, message } }
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function jsonError(code: ErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: ERROR_STATUS[code] });
}
