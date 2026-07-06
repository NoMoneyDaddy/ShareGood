import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { SubscriptionForm } from "./subscription-form";
import { SubscriptionList } from "./subscription-list";
import { WebPushToggle } from "./web-push-toggle";

export const metadata: Metadata = { title: "我的訂閱" };

// 我的訂閱頁（master-plan §6a 交付內容 10）：頂端「啟用瀏覽器推播通知」開關、
// 新增訂閱表單、目前訂閱列表（label／篩選條件摘要／即時開關／每日摘要開關／累積命中數）。
export default async function SubscriptionsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [categories, cities, subscriptions] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.userSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        keywords: { select: { id: true, keyword: true } },
        categories: { select: { category: { select: { id: true, name: true } } } },
        cities: { select: { city: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const ids = subscriptions.map((s) => s.id);
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

  const listItems = subscriptions.map((s) => ({
    id: s.id,
    label: s.label,
    immediateEnabled: s.immediateEnabled,
    dailyDigestEnabled: s.dailyDigestEnabled,
    keywords: s.keywords.map((k) => k.keyword),
    // 保留 {id, name} 而不是只留名稱字串：PATCH /api/subscriptions/[id] 是整包替換語意，
    // 前端切換即時通知／每日摘要開關時要能把原本的 categoryIds/cityIds 原封不動送回去，
    // 只有名稱字串會導致這兩個欄位只能送出空陣列，把使用者原本的篩選條件意外清空
    // （bot review 抓到的真實 bug，見 subscription-list.tsx 的 patch()）。
    categories: s.categories.map((c) => c.category),
    cities: s.cities.map((c) => c.city),
    matchCount: totalMap.get(s.id) ?? 0,
    pendingMatchCount: pendingMap.get(s.id) ?? 0,
  }));

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">我的訂閱</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        依關鍵字／分類／縣市設定訂閱條件，符合的新物品上架後依你的設定即時通知或每日摘要。
      </p>

      <div className="mt-6">
        <WebPushToggle publicKey={process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? ""} />
      </div>

      <div className="mt-6">
        <SubscriptionForm categories={categories} cities={cities} />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">目前訂閱（{listItems.length}）</h2>
        <SubscriptionList subscriptions={listItems} />
      </div>
    </main>
  );
}
