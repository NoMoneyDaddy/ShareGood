import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { LegalRequestForm } from "./legal-request-form";

export const metadata = { title: "警方／檢調調閱請求" };

const PAGE_SIZE = 30;

const STATUS_LABEL: Record<string, string> = {
  submitted: "已建檔，待審閱",
  legal_review: "法務審閱中",
  approved: "已核准",
  rejected: "已駁回",
  fulfilled: "已交付",
  closed: "已結案",
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
});

// /admin/legal-requests（master-plan §7a 交付內容 6／7）：機關調閱請求建檔、審核、匯出。
// ⚠️ 這個流程刻意不對外開放：一律由客服/admin 收到正式公文後在這裡手動建檔。
export default async function AdminLegalRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();

  const { cursor } = await searchParams;
  const rows = await db.lawEnforcementRequest.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">警方／檢調調閱請求</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        僅供內部人工建檔；建檔人與核准人必須是不同人（雙人審核）。
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">建檔</h2>
        <div className="mt-3">
          <LegalRequestForm />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">請求清單</h2>
        {page.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">目前沒有任何調閱請求。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {page.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/legal-requests/${r.id}`}
                  className="block rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-ink">
                      {r.agencyName}・{r.caseReference}
                    </p>
                    <Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    公文到站：{TAIPEI_FORMATTER.format(r.receivedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="mt-3">
            <Link
              href={`/admin/legal-requests?cursor=${page[page.length - 1].id}`}
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
