import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { DealInfoStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DEAL_INFO_DISCLAIMER } from "@/lib/deal-info";
import { DealInfoActions } from "./deal-info-actions";

const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
});

async function getDealInfo(id: string) {
  return db.dealInfo.findUnique({
    where: { id },
    include: {
      dealSource: true,
      submitter: { include: { profile: true } },
      cities: { include: { city: true } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dealInfo = await getDealInfo(id);
  // 比照 M2 REQUIRE_REVIEW 對物品詳情頁的既有處理：pending_review 對非投稿者/非
  // moderator/admin 一律 404、不產生 SEO metadata（master-plan §9a 交付內容 1）。
  if (!dealInfo || dealInfo.status === DealInfoStatus.pending_review) {
    return {};
  }
  const title = `${dealInfo.title}｜好康資訊`;
  const description = dealInfo.summary.slice(0, 120);
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

// M9（master-plan §9a 交付內容 1）：DealInfo 是純資訊內容，不進 claims/handover 狀態機。
// pending_review 對非投稿者/非 moderator/admin 一律 404；其餘狀態（published／stale／
// expired／rejected）對任何人皆可見（跟物品詳情頁對已完成/已到期物品維持可見一致）。
export default async function DealInfoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [dealInfo, session] = await Promise.all([getDealInfo(id), auth()]);
  if (!dealInfo) notFound();

  let isModerator = false;
  if (session?.user) {
    const roleCount = await db.userRole.count({
      where: { userId: session.user.id, role: { in: ["moderator", "admin"] } },
    });
    isModerator = roleCount > 0;
  }

  if (dealInfo.status === DealInfoStatus.pending_review) {
    const isSubmitter = session?.user?.id === dealInfo.submitterId;
    if (!isSubmitter && !isModerator) notFound();
  }

  const isSubmitter = session?.user?.id === dealInfo.submitterId;

  // JSON-LD：Article/WebPage 型別（非 Product/Offer，這不是可交易物品，master-plan §9a）。
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: dealInfo.title,
    description: dealInfo.summary,
    datePublished: (dealInfo.publishedAt ?? dealInfo.createdAt).toISOString(),
    dateModified: dealInfo.updatedAt.toISOString(),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* Next.js 官方建議的 JSON-LD 寫法，比照 src/app/(shell)/items/[id]/page.tsx 既有慣例。 */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 內容來自 JSON.stringify（已跳脫）＋額外 < 轉義，非使用者可控 HTML
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="flex items-center gap-1.5 text-sm text-ink-soft">
        <MapPin size={14} strokeWidth={2.4} aria-hidden="true" />
        {dealInfo.isNationwide ? "全台適用" : dealInfo.cities.map((c) => c.city.name).join("、")}
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-normal text-ink">{dealInfo.title}</h1>
      <p className="mt-3 whitespace-pre-wrap text-ink-soft">{dealInfo.summary}</p>

      <div className="mt-6 space-y-1.5 rounded-xl border border-line bg-card p-4 text-sm">
        <p>
          來源：
          <a
            href={dealInfo.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-brand-ink underline-offset-2 hover:underline"
          >
            {dealInfo.dealSource?.name ?? dealInfo.sourceUrl}
          </a>
        </p>
        <p className="text-ink-soft">
          查證日期：{TAIPEI_DATE_FORMATTER.format(dealInfo.verifiedAt)}
        </p>
        <p className="text-ink-soft">到期日：{TAIPEI_DATE_FORMATTER.format(dealInfo.expiresAt)}</p>
        {dealInfo.submitter && (
          <p className="text-ink-soft">
            投稿者：
            <Link
              href={`/u/${dealInfo.submitter.id}`}
              className="text-ink underline-offset-2 hover:underline"
            >
              {dealInfo.submitter.profile?.nickname ?? "好物共享用戶"}
            </Link>
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-ink-soft">{DEAL_INFO_DISCLAIMER}</p>

      <DealInfoActions
        dealInfoId={dealInfo.id}
        status={dealInfo.status}
        isLoggedIn={!!session?.user}
        isSubmitter={isSubmitter}
        isModerator={isModerator}
      />
    </div>
  );
}
