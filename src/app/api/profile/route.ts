import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";

// POST /api/profile — 設定/更新暱稱與縣市（onboarding 與個人設定共用）
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const body = await req.json().catch(() => null);
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  const cityId = typeof body?.cityId === "string" ? body.cityId : null;

  if (nickname.length < 2 || nickname.length > 20) {
    return jsonError("UNPROCESSABLE", "暱稱需為 2–20 個字");
  }
  if (cityId) {
    const city = await db.city.findUnique({ where: { id: cityId } });
    if (!city) return jsonError("UNPROCESSABLE", "無效的縣市");
  }

  const profile = await db.profile.upsert({
    where: { userId: user.id },
    update: { nickname, cityId },
    create: { userId: user.id, nickname, cityId },
  });

  return NextResponse.json({ nickname: profile.nickname, cityId: profile.cityId });
}
