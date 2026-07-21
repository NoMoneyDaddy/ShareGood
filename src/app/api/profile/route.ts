import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/profile — 設定/更新暱稱與縣市（onboarding 與個人設定共用）
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  // M2 治理底線 §7「功能限制」：疊加檢查，被全站封鎖（full_block）的使用者不能操作任何 mutation。
  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const body = await req.json().catch(() => null);
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  const cityId = typeof body?.cityId === "string" ? body.cityId : null;
  // M12 交付內容 4（排行榜 opt-out）：選填欄位，沒帶就維持既有值／預設 false，不強制
  // 每次呼叫都要傳（見 docs/plan/m12-product-growth.md 交付內容 4）。
  const leaderboardOptOut =
    typeof body?.leaderboardOptOut === "boolean" ? body.leaderboardOptOut : undefined;

  if (nickname.length < 2 || nickname.length > 20) {
    return jsonError("UNPROCESSABLE", "暱稱需為 2–20 個字");
  }
  if (cityId) {
    const city = await db.city.findUnique({ where: { id: cityId } });
    if (!city) return jsonError("UNPROCESSABLE", "無效的縣市");
  }

  const profile = await db.profile.upsert({
    where: { userId: user.id },
    update: { nickname, cityId, ...(leaderboardOptOut !== undefined ? { leaderboardOptOut } : {}) },
    create: { userId: user.id, nickname, cityId, leaderboardOptOut: leaderboardOptOut ?? false },
  });

  return NextResponse.json({
    nickname: profile.nickname,
    cityId: profile.cityId,
    leaderboardOptOut: profile.leaderboardOptOut,
  });
}
