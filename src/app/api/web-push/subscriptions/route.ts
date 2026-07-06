import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";

// POST /api/web-push/subscriptions — 前端把瀏覽器 PushSubscription.toJSON() 的
// endpoint/keys.p256dh/keys.auth 傳進來，upsert（依 endpoint unique）一筆
// web_push_subscriptions，isActive 重設為 true（同一裝置重新訂閱時復活舊紀錄而非產生
// 重複列）。查證來源：MDN PushSubscription.toJSON()（master-plan §6a 交付內容 3、9）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dhKey = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const authKey = typeof body?.keys?.auth === "string" ? body.keys.auth : "";

  if (!endpoint || !p256dhKey || !authKey) {
    return jsonError("UNPROCESSABLE", "缺少 endpoint 或加密金鑰");
  }

  const userAgent = req.headers.get("user-agent") ?? null;

  const subscription = await db.webPushSubscription.upsert({
    where: { endpoint },
    update: {
      userId: user.id,
      p256dhKey,
      authKey,
      userAgent,
      isActive: true,
      deactivatedAt: null,
      failureCount: 0,
    },
    create: { userId: user.id, endpoint, p256dhKey, authKey, userAgent },
  });

  return NextResponse.json({ id: subscription.id }, { status: 201 });
}

// DELETE /api/web-push/subscriptions — body 帶 endpoint，刪除呼叫者名下對應那一筆（多裝置
// 時只解除當下這一支裝置）；endpoint 不屬於呼叫者本人 → 404（不洩漏該筆資源是否存在）。
export async function DELETE(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const restriction = await checkFullBlock(user.id);
  if (restriction.blocked) {
    return jsonError("FORBIDDEN", restriction.message);
  }

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return jsonError("UNPROCESSABLE", "缺少 endpoint");
  }

  const existing = await db.webPushSubscription.findUnique({ where: { endpoint } });
  if (!existing || existing.userId !== user.id) {
    return jsonError("NOT_FOUND", "找不到這筆推播訂閱");
  }

  await db.webPushSubscription.delete({ where: { id: existing.id } });

  return NextResponse.json({ ok: true });
}
