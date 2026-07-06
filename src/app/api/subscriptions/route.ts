import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { checkFullBlock } from "@/lib/restrictions";
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  type ParsedSubscriptionInput,
  parseSubscriptionInput,
} from "@/lib/subscriptions";

const LIST_DEFAULT_PAGE_SIZE = 20;
const LIST_MAX_PAGE_SIZE = 50;

// POST /api/subscriptions — 建立一筆訂閱（master-plan §6a 交付內容 3）。
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
  const parsed = parseSubscriptionInput(body);
  if (!parsed.ok) {
    return jsonError("UNPROCESSABLE", parsed.message);
  }

  const invalidRefsError = await validateCategoryAndCityIds(parsed.value);
  if (invalidRefsError) return invalidRefsError;

  try {
    const subscription = await db.$transaction(async (tx) => {
      // 計數檢查與寫入不是同一個原子操作（已知取捨，見 master-plan §6a 交付內容 3：
      // 極小機率讓計數短暫超過 20，影響範圍僅止於使用者自己多出 1 筆訂閱，MVP 先接受）。
      const currentCount = await tx.userSubscription.count({ where: { userId: user.id } });
      if (currentCount >= MAX_SUBSCRIPTIONS_PER_USER) {
        throw new Error("SUBSCRIPTION_LIMIT_REACHED");
      }

      return tx.userSubscription.create({
        data: {
          userId: user.id,
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

    return NextResponse.json({ id: subscription.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "SUBSCRIPTION_LIMIT_REACHED") {
      return jsonError("UNPROCESSABLE", "訂閱已達上限（20 筆）");
    }
    throw e;
  }
}

async function validateCategoryAndCityIds(value: ParsedSubscriptionInput) {
  if (value.categoryIds.length > 0) {
    const count = await db.category.count({ where: { id: { in: value.categoryIds } } });
    if (count !== value.categoryIds.length) {
      return jsonError("UNPROCESSABLE", "包含無效的分類");
    }
  }
  if (value.cityIds.length > 0) {
    const count = await db.city.count({ where: { id: { in: value.cityIds } } });
    if (count !== value.cityIds.length) {
      return jsonError("UNPROCESSABLE", "包含無效的縣市");
    }
  }
  return null;
}

// GET /api/subscriptions — 列出自己的訂閱（cursor 分頁），每筆帶累積比對數與未通知數。
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, LIST_MAX_PAGE_SIZE)
      : LIST_DEFAULT_PAGE_SIZE;

  const subscriptions = await db.userSubscription.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      keywords: { select: { id: true, keyword: true } },
      categories: { select: { category: { select: { id: true, name: true } } } },
      cities: { select: { city: { select: { id: true, name: true } } } },
    },
  });

  const hasMore = subscriptions.length > take;
  const page = hasMore ? subscriptions.slice(0, take) : subscriptions;
  const ids = page.map((s) => s.id);

  const [totalCounts, pendingCounts] = await Promise.all([
    ids.length > 0
      ? db.subscriptionMatch.groupBy({
          by: ["subscriptionId"],
          where: { subscriptionId: { in: ids } },
          _count: { _all: true },
        })
      : [],
    ids.length > 0
      ? db.subscriptionMatch.groupBy({
          by: ["subscriptionId"],
          where: { subscriptionId: { in: ids }, notifiedAt: null },
          _count: { _all: true },
        })
      : [],
  ]);
  const totalMap = new Map(totalCounts.map((c) => [c.subscriptionId, c._count._all]));
  const pendingMap = new Map(pendingCounts.map((c) => [c.subscriptionId, c._count._all]));

  return NextResponse.json({
    subscriptions: page.map((s) => ({
      id: s.id,
      label: s.label,
      immediateEnabled: s.immediateEnabled,
      dailyDigestEnabled: s.dailyDigestEnabled,
      keywords: s.keywords.map((k) => ({ id: k.id, keyword: k.keyword })),
      categories: s.categories.map((c) => c.category),
      cities: s.cities.map((c) => c.city),
      createdAt: s.createdAt,
      matchCount: totalMap.get(s.id) ?? 0,
      pendingMatchCount: pendingMap.get(s.id) ?? 0,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
