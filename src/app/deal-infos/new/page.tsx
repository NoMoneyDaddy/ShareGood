import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { DealInfoForm } from "./deal-info-form";

export const metadata = { title: "投稿好康資訊" };

// /deal-infos/new — DealInfo 投稿表單（master-plan §9a 交付內容 1）。比照 /items/new
// 既有慣例：未登入導回首頁、未完成 onboarding（無 profile）導去 /onboarding。
export default async function NewDealInfoPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const profile = await db.profile.findUnique({ where: { userId: session.user.id } });
  if (!profile) redirect("/onboarding");

  const roles = await db.userRole.findMany({
    where: { userId: session.user.id },
    select: { role: true },
  });
  const isModerator = roles.some((r) => r.role === "moderator" || r.role === "admin");

  const [cities, dealSources] = await Promise.all([
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    // 只有 moderator/admin 用得到來源下拉選單（人工收錄，交付內容 2），一般使用者投稿
    // 不需要查這張表，省一趟資料庫往返。
    isModerator
      ? db.dealSource.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">投稿好康資訊</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        分享目前正在進行的優惠活動——寫清楚活動內容、附上官方連結，讓其他人也能查證。禁止複製官方圖文，請自己轉述事實。
      </p>
      <DealInfoForm cities={cities} isModerator={isModerator} dealSources={dealSources} />
    </main>
  );
}
