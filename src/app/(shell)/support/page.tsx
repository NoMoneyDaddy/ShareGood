import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "問題回報" };

const CATEGORY_LABEL: Record<string, string> = {
  bug: "功能異常",
  account: "帳號問題",
  other: "其他",
};

const STATUS_LABEL: Record<string, string> = {
  open: "待處理",
  in_progress: "處理中",
  resolved: "已解決",
  closed: "已結案",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "secondary",
  resolved: "outline",
  closed: "outline",
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "short",
});

// 使用者回報入口（master-plan §7 交付內容 5）：bug／帳號問題／其他，登入使用者才能送出，
// 頁面同時列出自己過往送出的回報，點進去看處理進度（/support/[id]）。
export default async function SupportPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const tickets = await db.supportTicket.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, category: true, subject: true, status: true, createdAt: true },
  });

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">問題回報</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        遇到功能異常或帳號問題嗎？告訴我們發生了什麼，我們會盡快處理。
      </p>

      <div className="mt-6">
        <TicketForm />
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-lg font-bold tracking-tight">我的回報紀錄</h2>
        {tickets.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="目前沒有回報紀錄"
            description="你送出的問題回報都會顯示在這裡，可以隨時回來查看處理進度。"
          />
        ) : (
          <ul className="mt-4 space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/support/${t.id}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 transition-colors hover:bg-paper-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {CATEGORY_LABEL[t.category] ?? t.category}・
                      {TAIPEI_FORMATTER.format(t.createdAt)}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
