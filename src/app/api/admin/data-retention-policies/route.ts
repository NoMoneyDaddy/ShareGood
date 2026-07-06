import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";

// GET /api/admin/data-retention-policies — 資料保留政策清單（master-plan §7a 交付內容 4）。
// moderator/admin 可查看，只有 admin 可以修改（見 [id]/route.ts）。清單筆數目前是固定的
// seed 常數（十來筆），不會無限成長，但仍照全站慣例回傳陣列前限制筆數，不做 SELECT *。
export async function GET() {
  try {
    await requireRole("moderator");
  } catch (e) {
    if (e instanceof AuthzError) {
      return jsonError(e.code, e.code === "UNAUTHORIZED" ? "請先登入" : "需要管理權限");
    }
    throw e;
  }

  const policies = await db.dataRetentionPolicy.findMany({
    orderBy: { policyKey: "asc" },
    take: 200,
  });

  return NextResponse.json({
    items: policies.map((p) => ({
      id: p.id,
      policyKey: p.policyKey,
      description: p.description,
      retentionDays: p.retentionDays,
      action: p.action,
      isActive: p.isActive,
      updatedAt: p.updatedAt,
    })),
  });
}
