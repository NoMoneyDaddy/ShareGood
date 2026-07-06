import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "./admin-nav";

export const metadata = { title: "後台管理" };

// 未結案的檢舉／回報／待複審申訴分別對應各自狀態機裡「還沒走到終態」的狀態集合，
// 跟 src/app/api/reports/[id]/route.ts 的 ALLOWED_TRANSITIONS、
// src/lib/support-tickets.ts 的 ALLOWED_STATUS_TRANSITIONS、
// src/app/api/appeals/[id]/route.ts 的 pending 判斷保持一致。
const OPEN_REPORT_STATUSES = ["submitted", "triaged", "in_progress"] as const;
const OPEN_SUPPORT_TICKET_STATUSES = ["open", "in_progress"] as const;

type DashboardCard = {
  href: string;
  label: string;
  count: number;
  description: string;
};

// `/admin` 首頁（master-plan §7 第 7 項「後台最小集」）：moderator/admin 限定，其餘一律 404
// （比照 /admin/support-tickets 現有的權限判斷寫法，不透露這個頁面存在）。這是整個治理後台
// 的入口，給待辦總覽三個數字＋物品／使用者／稽核紀錄的導覽入口，避免每個子頁各自變成
// 「網址存在但沒有入口點得到」的孤兒頁。
export default async function AdminDashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const [pendingReports, pendingSupportTickets, pendingAppeals] = await Promise.all([
    db.report.count({ where: { status: { in: [...OPEN_REPORT_STATUSES] } } }),
    db.supportTicket.count({ where: { status: { in: [...OPEN_SUPPORT_TICKET_STATUSES] } } }),
    db.appeal.count({ where: { status: "pending" } }),
  ]);

  const cards: DashboardCard[] = [
    {
      href: "/admin/reports",
      label: "未處理檢舉",
      count: pendingReports,
      description: "狀態為已送出／已分類／處理中的檢舉",
    },
    {
      href: "/admin/support-tickets",
      label: "待處理的使用者回報",
      count: pendingSupportTickets,
      description: "狀態為待處理／處理中的 bug 與帳號問題回報",
    },
    {
      href: "/admin/appeals",
      label: "待複審申訴",
      count: pendingAppeals,
      description: "被下架／被限制者提出、尚未複審的申訴",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">後台管理</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        治理底線工具：檢舉處理、下架、使用者限制、申訴複審、稽核紀錄。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin" />
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink-soft">{card.label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-ink">{card.count}</p>
            <p className="mt-1 text-xs text-ink-soft">{card.description}</p>
          </Link>
        ))}
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-lg font-bold tracking-tight">其他治理工具</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Link
            href="/admin/items"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">物品管理</p>
            <p className="mt-1 text-xs text-ink-soft">搜尋物品、必要時強制下架</p>
          </Link>
          <Link
            href="/admin/users"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">使用者管理</p>
            <p className="mt-1 text-xs text-ink-soft">搜尋使用者、建立或解除功能限制</p>
          </Link>
          <Link
            href="/admin/audit-logs"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">稽核紀錄查詢</p>
            <p className="mt-1 text-xs text-ink-soft">
              所有管理操作（actor／action／target／時間）
            </p>
          </Link>
          {/* M8 營運強化（master-plan §8a）／M7 資料權利與法務（master-plan §7a）：這四頁一直
              存在，只是沒有從 /admin 首頁連過去，補上避免孤兒頁（比照上面既有卡片的處理方式）。 */}
          <Link
            href="/admin/ops"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">營運儀表板</p>
            <p className="mt-1 text-xs text-ink-soft">
              資料庫／儲存／背景工作健康檢查、慢查詢與通知重送
            </p>
          </Link>
          <Link
            href="/admin/data"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">資料管理</p>
            <p className="mt-1 text-xs text-ink-soft">資料保留政策設定與清除紀錄查詢</p>
          </Link>
          <Link
            href="/admin/legal-holds"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">訴訟保全（admin-only）</p>
            <p className="mt-1 text-xs text-ink-soft">建立／解除訴訟保全，暫停資料清除與去識別化</p>
          </Link>
          <Link
            href="/admin/legal-requests"
            className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
          >
            <p className="text-sm font-medium text-ink">警方／檢調調閱請求</p>
            <p className="mt-1 text-xs text-ink-soft">不對外開放，僅供客服/admin 收到公文後建檔</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
