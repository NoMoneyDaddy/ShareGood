import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { DocumentUpload } from "./document-upload";
import { ExportDownloadButton, LegalRequestActions } from "./legal-request-actions";

const STATUS_LABEL: Record<string, string> = {
  submitted: "已建檔，待審閱",
  legal_review: "法務審閱中",
  approved: "已核准",
  rejected: "已駁回",
  fulfilled: "已交付",
  closed: "已結案",
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  user: "使用者",
  item: "物品",
  conversation: "對話",
  message: "訊息",
};

const EVENT_ACTION_LABEL: Record<string, string> = {
  submitted: "建檔",
  document_uploaded: "上傳公文",
  approved: "核准",
  rejected: "駁回",
  export_generated: "產生匯出包",
  export_downloaded: "下載匯出包",
};

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "medium",
});

// /admin/legal-requests/[id]（master-plan §7a 交付內容 6／7）：調閱請求詳情、審核、
// 產生/下載匯出包、上傳公文、逐筆事件時間序。
export default async function AdminLegalRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const user = await db.user.findUnique({ where: { id: userId }, include: { roles: true } });
  if (!user || !isModeratorOrAdmin(user)) notFound();
  const isAdmin = user.roles.some((r) => r.role === "admin");

  const { id } = await params;
  const request = await db.lawEnforcementRequest.findUnique({
    where: { id },
    include: {
      targets: true,
      documents: true,
      events: { orderBy: { createdAt: "asc" } },
      exports: true,
    },
  });
  if (!request) notFound();

  // 雙人審核：只有 admin，且不是建檔人本人，才能核准/駁回。
  const canReview = isAdmin && request.submittedBy !== userId;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 pb-24 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {request.agencyName}・{request.caseReference}
        </h1>
        <Badge variant="outline">{STATUS_LABEL[request.status] ?? request.status}</Badge>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-ink-soft">法源條文</dt>
          <dd className="text-ink">{request.legalBasis}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">調閱範圍</dt>
          <dd className="text-ink">{request.requestScope}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">公文到站日期</dt>
          <dd className="text-ink">{TAIPEI_FORMATTER.format(request.receivedAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">是否通知當事人</dt>
          <dd className="text-ink">{request.notifyUser ? "是" : "否（已載明法律依據）"}</dd>
        </div>
        {request.rejectionReason && (
          <div>
            <dt className="text-ink-soft">駁回原因</dt>
            <dd className="text-ink">{request.rejectionReason}</dd>
          </div>
        )}
      </dl>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">調閱範圍目標</h2>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {request.targets.map((t) => (
            <li key={t.id} className="rounded-full bg-paper-2 px-2 py-0.5 text-xs text-ink-soft">
              {TARGET_TYPE_LABEL[t.targetType] ?? t.targetType}：{t.targetId}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">
          公文掃描檔（{request.documents.length}）
        </h2>
        <div className="mt-2">
          <DocumentUpload requestId={request.id} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">審核與匯出</h2>
        <div className="mt-2">
          <LegalRequestActions requestId={request.id} status={request.status} canAct={canReview} />
          {!canReview && (request.status === "submitted" || request.status === "legal_review") && (
            <p className="text-sm text-ink-soft">
              {isAdmin
                ? "建檔人不能核准/駁回自己建立的請求，需由另一位管理者審核。"
                : "只有管理者可以審核。"}
            </p>
          )}
        </div>
      </section>

      {request.exports.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-ink-soft">匯出包</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {request.exports.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-xl border border-line bg-card p-3"
              >
                <span className="text-xs text-ink-soft">
                  產生於 {TAIPEI_FORMATTER.format(e.generatedAt)}
                </span>
                {isAdmin && <ExportDownloadButton requestId={request.id} exportId={e.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">處理時間序</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-ink-soft">
          {request.events.map((e) => (
            <li key={`${e.action}-${e.createdAt.getTime()}`}>
              {TAIPEI_FORMATTER.format(e.createdAt)}・{EVENT_ACTION_LABEL[e.action] ?? e.action}
              {e.note && `（${e.note}）`}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
