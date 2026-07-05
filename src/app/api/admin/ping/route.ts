import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";

// M0 驗收用的 admin-only 端點（權限中介層煙霧測試），之後後台功能沿用同一模式。
export async function GET() {
  try {
    const user = await requireRole("admin");
    return NextResponse.json({ ok: true, admin: user.email });
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要 admin 權限");
    }
    throw e;
  }
}
