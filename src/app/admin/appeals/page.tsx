import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AdminNav } from "../admin-nav";
import { AppealsPanel } from "./appeals-panel";

export const metadata = { title: "申訴複審" };

// 後台申訴複審頁（master-plan §7 第 6、7 項）：master-plan 明確寫「admin 複審」，且既有的
// GET /api/appeals?scope=all（src/app/api/appeals/route.ts）本來就只有 admin 能看到全站
// 待審佇列（moderator 帶 scope=all 會被那支 API 當作沒帶處理，只回自己的申訴列表——對
// moderator 幾乎必定是空的）。與其讓 moderator 進來看到一個誤導性的空列表，這裡刻意把
// 頁面權限收得比其餘 /admin/* 子頁更嚴：僅 admin 可見，moderator 一律 404
// （比照 /admin/support-tickets 的既有寫法，只是判斷條件換成 admin-only）。
// 資料讀取／複審動作都呼叫既有的 GET /api/appeals?scope=all、GET /api/appeals/[id]、
// PATCH /api/appeals/[id]，不重寫那幾支 API 本身的邏輯。
export default async function AdminAppealsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  const isAdmin = user?.roles.some((r) => r.role === "admin") ?? false;
  if (!isAdmin) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">申訴複審</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        被下架／被限制者對自己名下紀錄提出的申訴，需管理者複審核准或駁回。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/appeals" />
      </div>

      <div className="mt-6">
        <AppealsPanel />
      </div>
    </main>
  );
}
