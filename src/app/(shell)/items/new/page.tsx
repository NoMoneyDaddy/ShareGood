import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BackBar } from "@/components/back-bar";
import { db } from "@/lib/db";
import { ItemForm } from "./item-form";

export const metadata = { title: "上架好物" };

export default async function NewItemPage() {
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
      <BackBar fallbackHref="/items" />
      <h1 className="text-2xl font-bold tracking-tight">上架好物</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        拍照、寫一句分享的理由，選好分類跟縣市就能發布。發布後任何人都能看到，不需要審核。
      </p>
      {/* M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：一次要分享多筆相似
          物品時的捷徑入口，服務冷啟動期團隊/親友大量上架。 */}
      <p className="mt-2 text-sm text-ink-soft">
        一次要分享好幾件物品？
        <Link
          href="/items/new/batch"
          className="ml-1 font-medium text-brand underline underline-offset-2"
        >
          改用批量上架
        </Link>
      </p>
      <ItemForm categories={categories} cities={cities} defaultCityId={profile.cityId ?? ""} />
    </div>
  );
}
