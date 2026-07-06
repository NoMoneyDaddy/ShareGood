import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";
import { type ParsedSubscriptionInput, parseSubscriptionInput } from "@/lib/subscriptions";

async function validateCategoryAndCityIds(value: ParsedSubscriptionInput) {
  if (value.categoryIds.length > 0) {
    const count = await db.category.count({ where: { id: { in: value.categoryIds } } });
    if (count !== value.categoryIds.length) return "包含無效的分類";
  }
  if (value.cityIds.length > 0) {
    const count = await db.city.count({ where: { id: { in: value.cityIds } } });
    if (count !== value.cityIds.length) return "包含無效的縣市";
  }
  return null;
}

// GET /api/subscriptions/[id] — 單筆詳情；非本人 403。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { id } = await params;
  const subscription = await db.userSubscription.findUnique({
    where: { id },
    include: {
      keywords: { select: { id: true, keyword: true } },
      categories: { select: { category: { select: { id: true, name: true } } } },
      cities: { select: { city: { select: { id: true, name: true } } } },
    },
  });
  if (!subscription) return jsonError("NOT_FOUND", "找不到這筆訂閱");
  if (subscription.userId !== user.id) return jsonError("FORBIDDEN", "無權查看這筆訂閱");

  return NextResponse.json({
    id: subscription.id,
    label: subscription.label,
    immediateEnabled: subscription.immediateEnabled,
    dailyDigestEnabled: subscription.dailyDigestEnabled,
    keywords: subscription.keywords.map((k) => ({ id: k.id, keyword: k.keyword })),
    categories: subscription.categories.map((c) => c.category),
    cities: subscription.cities.map((c) => c.city),
    createdAt: subscription.createdAt,
  });
}

// PATCH /api/subscriptions/[id] — 整包替換語意：同一 transaction 內刪除舊的
// keywords/categories/cities，依 request body 重新寫入（master-plan §6a 交付內容 3）。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const existing = await db.userSubscription.findUnique({ where: { id } });
  if (!existing) return jsonError("NOT_FOUND", "找不到這筆訂閱");
  if (existing.userId !== user.id) return jsonError("FORBIDDEN", "無權修改這筆訂閱");

  const body = await req.json().catch(() => null);
  const parsed = parseSubscriptionInput(body);
  if (!parsed.ok) {
    return jsonError("UNPROCESSABLE", parsed.message);
  }

  const invalidRefsMessage = await validateCategoryAndCityIds(parsed.value);
  if (invalidRefsMessage) return jsonError("UNPROCESSABLE", invalidRefsMessage);

  await db.$transaction(async (tx) => {
    await tx.subscriptionKeyword.deleteMany({ where: { subscriptionId: id } });
    await tx.subscriptionCategory.deleteMany({ where: { subscriptionId: id } });
    await tx.subscriptionCity.deleteMany({ where: { subscriptionId: id } });

    await tx.userSubscription.update({
      where: { id },
      data: {
        label: parsed.value.label,
        immediateEnabled: parsed.value.immediateEnabled,
        dailyDigestEnabled: parsed.value.dailyDigestEnabled,
        keywords: {
          create: parsed.value.keywords.map((k) => ({
            keyword: k.keyword,
            normalizedKeyword: k.normalizedKeyword,
          })),
        },
        categories: { create: parsed.value.categoryIds.map((categoryId) => ({ categoryId })) },
        cities: { create: parsed.value.cityIds.map((cityId) => ({ cityId })) },
      },
    });
  });

  return NextResponse.json({ id });
}

// DELETE /api/subscriptions/[id] — FK cascade 一併刪掉 keywords/categories/cities/matches；
// 非本人 403。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const existing = await db.userSubscription.findUnique({ where: { id } });
  if (!existing) return jsonError("NOT_FOUND", "找不到這筆訂閱");
  if (existing.userId !== user.id) return jsonError("FORBIDDEN", "無權刪除這筆訂閱");

  await db.userSubscription.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
