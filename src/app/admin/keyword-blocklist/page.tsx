import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { AdminNav } from "../admin-nav";
import { CreateKeywordForm, ToggleKeywordButton } from "./keyword-blocklist-panel";

export const metadata = { title: "關鍵字黑名單" };

const PAGE_SIZE = 50;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// /admin/keyword-blocklist（master-plan §9a 交付內容 3，研究 01「可立即修正」清單 #6）：
// keyword_blocklist 表從 M2 就存在，但一直沒有管理頁，只能直接改資料庫；moderator/admin
// 才能看，其餘一律 404（比照既有 /admin/users 等頁面的權限判斷寫法）。實際新增/停用動作
// 呼叫既有的 POST/PATCH /api/admin/keyword-blocklist[...]，不重寫那兩支 API 的邏輯。
export default async function AdminKeywordBlocklistPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const actor = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!actor || !isModeratorOrAdmin(actor)) notFound();

  const { cursor } = await searchParams;
  const rows = await db.keywordBlocklist.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">關鍵字黑名單</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        管理攔截上架標題/描述與留言內容的關鍵字詞條；停用不會刪除紀錄，只是暫時不生效。
      </p>

      <div className="mt-6">
        <AdminNav current="/admin/keyword-blocklist" />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">新增詞條</h2>
        <div className="mt-3">
          <CreateKeywordForm />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">詞條清單</h2>
        {page.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
            目前沒有任何關鍵字詞條
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {page.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">{row.keyword}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    建立於 {TAIPEI_FORMATTER.format(row.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={row.isActive ? "default" : "outline"}>
                    {row.isActive ? "生效中" : "已停用"}
                  </Badge>
                  <ToggleKeywordButton id={row.id} isActive={row.isActive} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/keyword-blocklist?cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
