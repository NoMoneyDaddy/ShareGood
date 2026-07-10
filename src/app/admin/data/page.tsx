import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { RETENTION_ACTION_LABEL, RETENTION_TARGET_TYPE_LABEL } from "@/lib/retention-labels";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { RetentionPolicyRow } from "./retention-policy-row";

export const metadata = { title: "資料保留政策與清除紀錄" };

const PAGE_SIZE = 30;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "medium",
});

// 後台資料管理（master-plan §7a 交付內容 4／7）：retention 政策清單與編輯（只有 admin 能改，
// moderator 唯讀）、data_purge_logs 查詢。跟 /admin/support-tickets 一樣是獨立成頁的最小
// 可用介面，完整 /admin 殼留給之後補上。
export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();
  const isAdmin = user.roles.some((r) => r.role === "admin");

  const { cursor } = await searchParams;

  const [policies, purgeLogs] = await Promise.all([
    db.dataRetentionPolicy.findMany({ orderBy: { policyKey: "asc" } }),
    db.dataPurgeLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  ]);
  const hasMore = purgeLogs.length > PAGE_SIZE;
  const logsPage = hasMore ? purgeLogs.slice(0, PAGE_SIZE) : purgeLogs;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">資料保留政策與清除紀錄</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        保留天數與到期後的處理方式都可以在這裡調整，系統每天清理時會依最新設定執行。
      </p>

      <section className="mt-6 overflow-x-auto">
        <h2 className="text-sm font-semibold text-ink-soft">政策清單</h2>
        <table className="mt-3 w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-soft">
              <th className="pb-2 pr-3 font-medium">政策</th>
              <th className="pb-2 pr-3 font-medium">保留天數</th>
              <th className="pb-2 pr-3 font-medium">動作</th>
              <th className="pb-2 pr-3 font-medium">狀態</th>
              <th className="pb-2 font-medium">{isAdmin ? "" : "（僅管理者可編輯）"}</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) =>
              isAdmin ? (
                <RetentionPolicyRow
                  key={p.id}
                  policy={{
                    id: p.id,
                    policyKey: p.policyKey,
                    description: p.description,
                    retentionDays: p.retentionDays,
                    action: p.action,
                    isActive: p.isActive,
                  }}
                />
              ) : (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-ink">{p.policyKey}</p>
                    <p className="text-xs text-ink-soft">{p.description}</p>
                  </td>
                  <td className="py-2 pr-3">{p.retentionDays ?? "不自動清理"}</td>
                  <td className="py-2 pr-3">{p.action ? (RETENTION_ACTION_LABEL[p.action] ?? p.action) : "—"}</td>
                  <td className="py-2">{p.isActive ? "啟用" : "停用"}</td>
                  <td />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      <section className="mt-10 overflow-x-auto">
        <h2 className="text-sm font-semibold text-ink-soft">清除紀錄</h2>
        {logsPage.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">目前沒有任何清除紀錄。</p>
        ) : (
          <table className="mt-3 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-soft">
                <th className="pb-2 pr-3 font-medium">時間</th>
                <th className="pb-2 pr-3 font-medium">政策</th>
                <th className="pb-2 pr-3 font-medium">目標</th>
                <th className="pb-2 pr-3 font-medium">動作</th>
                <th className="pb-2 font-medium">是否被訴訟保全擋下</th>
              </tr>
            </thead>
            <tbody>
              {logsPage.map((log) => (
                <tr key={log.id} className="border-b border-line">
                  <td className="py-2 pr-3 text-xs text-ink-soft">
                    {TAIPEI_FORMATTER.format(log.createdAt)}
                  </td>
                  <td className="py-2 pr-3">{log.policyKey}</td>
                  <td className="py-2 pr-3 text-xs text-ink-soft">
                    {RETENTION_TARGET_TYPE_LABEL[log.targetType] ?? log.targetType}:{log.targetId}
                  </td>
                  <td className="py-2 pr-3">
                    {RETENTION_ACTION_LABEL[log.actionTaken] ?? log.actionTaken}
                  </td>
                  <td className="py-2">{log.skippedLegalHold ? "是" : "否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hasMore && (
          <div className="mt-3">
            <Link
              href={`/admin/data?cursor=${logsPage[logsPage.length - 1].id}`}
              className="text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            >
              下一頁 →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
