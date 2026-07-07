import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { DealSourcesPanel } from "./deal-sources-panel";

export const metadata = { title: "好康來源管理" };

// /admin/deal-sources（master-plan §9a 交付內容 2）：S1 官方來源主檔維護。moderator/admin
// 限定，其餘一律 404（比照既有 /admin/* 頁慣例）。列表本身用既有 GET /api/admin/deal-sources
// 由客端面板抓取（見 deal-sources-panel.tsx），這裡的伺服器元件只負責權限檢查與掛
// 共用導覽，維護動作全部走 API（跟 /admin/reports、/admin/appeals 同一種「client panel
// 呼叫 API」慣例，跟 /admin/support-tickets「伺服器元件直接查 db」慣例不同——這裡選
// client panel 是因為需要建立表單＋逐列編輯，互動性比純列表高）。
export default async function AdminDealSourcesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">好康來源管理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        S1 官方來源主檔（方案 B：人工收錄自寫摘要＋導流，全程排除自動抓取）。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/deal-sources" />
      </div>

      <div className="mt-6">
        <DealSourcesPanel />
      </div>
    </main>
  );
}
