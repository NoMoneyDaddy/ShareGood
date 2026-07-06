import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { LegalHoldForm } from "./legal-hold-form";
import { ReleaseButton } from "./release-button";

export const metadata = { title: "訴訟保全（Legal Hold）" };

const PAGE_SIZE = 30;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "medium",
});

// /admin/legal-holds（master-plan §7a 交付內容 5／7）：建立/解除訴訟保全，依 target_type/
// target_id 查詢。只有 admin 角色可以建立/解除，這裡整頁限定 admin 才看得到（比 moderator
// 唯讀更收斂一層，因為 legal hold 本身可能涉及敏感調查資訊）。
export default async function AdminLegalHoldsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user?.roles.some((r) => r.role === "admin")) notFound();

  const { cursor } = await searchParams;
  const rows = await db.legalHold.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { targets: true },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">訴訟保全（Legal Hold）</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        被保全的資料即使超過 retention 政策的保留期限，也不會被清除 job 處理。
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">建立新的保全</h2>
        <div className="mt-3">
          <LegalHoldForm />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">保全清單</h2>
        {page.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">目前沒有任何保全紀錄。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {page.map((hold) => (
              <li key={hold.id} className="rounded-xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-ink">{hold.reason}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      建立於 {TAIPEI_FORMATTER.format(hold.createdAt)}
                      {hold.status === "released" &&
                        hold.releasedAt &&
                        `・已於 ${TAIPEI_FORMATTER.format(hold.releasedAt)} 解除`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={hold.status === "active" ? "default" : "outline"}>
                      {hold.status === "active" ? "生效中" : "已解除"}
                    </Badge>
                    {hold.status === "active" && <ReleaseButton holdId={hold.id} />}
                  </div>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {hold.targets.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-full bg-paper-2 px-2 py-0.5 text-xs text-ink-soft"
                    >
                      {t.targetType}:{t.targetId}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="mt-3">
            <Link
              href={`/admin/legal-holds?cursor=${page[page.length - 1].id}`}
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
