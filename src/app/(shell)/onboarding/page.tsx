import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "設定個人資料" };

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const [profile, cities] = await Promise.all([
    db.profile.findUnique({ where: { userId: session.user.id } }),
    db.city.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">歡迎加入 ShareGood</h1>
      <p className="mt-2 text-muted-foreground">設定暱稱與所在縣市，就可以開始分享與接收好物。</p>
      <OnboardingForm
        cities={cities}
        defaultNickname={profile?.nickname ?? session.user.name ?? ""}
        defaultCityId={profile?.cityId ?? ""}
      />
    </div>
  );
}
