import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
      <h1 className="text-2xl font-bold tracking-tight">上架好物</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        拍照、寫一句分享的理由，選好分類跟縣市就能發布。發布後任何人都能看到，不需要審核。
      </p>
      <ItemForm categories={categories} cities={cities} defaultCityId={profile.cityId ?? ""} />
    </div>
  );
}
