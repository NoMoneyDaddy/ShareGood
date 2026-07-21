import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BackBar } from "@/components/back-bar";
import { db } from "@/lib/db";
import { BatchItemForm } from "./batch-item-form";

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：`/items/new` 的「一次建立
// 多筆相似物品」捷徑，服務冷啟動期團隊/親友大量上架。權限檢查（登入／onboarding）比照既有
// `/items/new` 完全相同的寫法。
export const metadata = { title: "批量上架" };

export default async function BatchNewItemPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const profile = await db.profile.findUnique({ where: { userId: session.user.id } });
  if (!profile) redirect("/onboarding");

  const [categories, cities] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <BackBar fallbackHref="/items/new" />
      <h1 className="text-2xl font-bold tracking-tight">批量上架</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        一次建立多筆相似的物品，適合團體出清或整理二手物。優惠券／即期食品／電子票券／點數好康請個別到一般表單上架（各自有專屬欄位）。
      </p>
      <BatchItemForm categories={categories} cities={cities} defaultCityId={profile.cityId ?? ""} />
    </div>
  );
}
