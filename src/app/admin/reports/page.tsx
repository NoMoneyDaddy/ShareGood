import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { ReportsPanel } from "./reports-panel";

export const metadata = { title: "檢舉處理" };

// 後台檢舉列表頁（master-plan §7 第 7 項）：moderator/admin 才能看，其餘一律 404
// （比照 /admin/support-tickets 現有的權限判斷寫法）。頁面本身只負責權限檢查與外殼，
// 實際資料的讀取／狀態轉換都由 ReportsPanel 呼叫既有的 GET/PATCH /api/reports[/:id]，
// 不在這裡重寫一份查詢邏輯（scope=all 的權限判斷已經在那支 API 裡）。
export default async function AdminReportsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">檢舉處理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        對物品／留言／私訊的檢舉，依 submitted → triaged → in_progress → resolved/rejected → closed
        狀態機處理。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/reports" />
      </div>

      <div className="mt-6">
        <ReportsPanel />
      </div>
    </main>
  );
}
