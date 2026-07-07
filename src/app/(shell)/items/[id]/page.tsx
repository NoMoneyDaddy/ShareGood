import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { ReportButton } from "@/components/report-button";
import type { ItemStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/storage";
import { ClaimsSection } from "./claims-section";
import { CouponSection } from "./coupon-section";
import { CouponUsageSection } from "./coupon-usage-section";
import { DirectShareSection } from "./direct-share-section";
import { HandoverSection } from "./handover-section";
import { LotterySection } from "./lottery-section";
import { PointSection } from "./point-section";
import { ThanksSection } from "./thanks-section";
import { TicketSection } from "./ticket-section";

async function getItem(id: string) {
  return db.item.findUnique({
    where: { id },
    include: {
      category: true,
      city: true,
      owner: { include: { profile: true } },
      images: {
        orderBy: { sortOrder: "asc" },
        include: { thumbObject: true, mediumObject: true },
      },
      // M3（master-plan §8）：只查 CouponDetail（面額／店家／備註，描述性文字非機密），
      // 不 include 它底下的 CouponSecret——券碼密文完全不進這支查詢，也不會出現在這個頁面。
      couponDetail: true,
      // M9（master-plan §9a 交付內容 4/5）：票券／點數 detail 表皆無機密欄位，直接查即可。
      ticketDetail: true,
      pointDetail: true,
    },
  });
}

// SEO/AEO（master-plan §3.7）：物品狀態對應 schema.org Offer availability。
function offerAvailability(status: ItemStatus) {
  switch (status) {
    case "published":
      return "https://schema.org/InStock";
    case "reserved":
    case "handover_pending":
      return "https://schema.org/LimitedAvailability";
    default:
      return "https://schema.org/SoldOut";
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await getItem(id);
  // M2 治理底線：REQUIRE_REVIEW 開啟時新物品先進 pending_review，審核通過前不產生
  // 公開 SEO metadata（避免搜尋引擎索引到尚未審核的內容）。
  if (!item || item.status === "removed_by_moderator" || item.status === "pending_review") {
    return {};
  }
  const title = `${item.title}｜${item.city.name}`;
  const description = item.description.slice(0, 120);
  const firstImage = item.images[0];
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(firstImage ? { images: [publicUrl(firstImage.mediumObject.objectKey)] } : {}),
    },
  };
}

// M1：發布即公開，任何人（含未登入）都能看物品詳情；留言/直贈是後續才做的功能。
// M2：REQUIRE_REVIEW 開啟時新物品先進 pending_review，審核通過前只有物主自己能預覽，
// 其他人（含未登入）一律視為找不到，避免繞過審核直接分享連結公開瀏覽。
export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [item, session] = await Promise.all([getItem(id), auth()]);
  if (!item || item.status === "removed_by_moderator") notFound();
  if (item.status === "pending_review" && session?.user?.id !== item.ownerId) notFound();

  // session/profile 給 SiteHeader 用的查詢已收斂進 (shell)/layout.tsx，這裡的 session
  // 只用於本頁內容判斷（擁有者/接手者權限、檢舉按鈕顯示等）。

  // 交接區塊需要知道「目前登入者是不是被接受的那個人」；reserved 狀態下接手者資訊在
  // ClaimComment/DirectShare 裡（handover 還沒建立），handover_pending／completed 狀態下
  // 則直接查 HandoverRecord（懶建立模式，見 handover/ensure route 的說明）。
  let isReceiver = false;
  let handoverId: string | null = null;
  let conversationId: string | null = null;
  if (session?.user) {
    if (item.status === "reserved") {
      const [acceptedClaim, acceptedDirectShare] = await Promise.all([
        db.claimComment.findFirst({ where: { itemId: item.id, status: "accepted" } }),
        db.directShare.findFirst({ where: { itemId: item.id, status: "accepted" } }),
      ]);
      const receiverId = acceptedClaim?.userId ?? acceptedDirectShare?.receiverId;
      isReceiver = receiverId === session.user.id;
    } else if (item.status === "handover_pending" || item.status === "completed") {
      const [handover, conversation] = await Promise.all([
        db.handoverRecord.findUnique({ where: { itemId: item.id } }),
        db.conversation.findUnique({ where: { itemId: item.id } }),
      ]);
      isReceiver = handover?.receiverId === session.user.id;
      handoverId = handover?.id ?? null;
      conversationId = conversation?.id ?? null;
    }
  }

  // M5 抽籤（master-plan §5a 交付內容 2）：物品存在非終態抽籤時，留言/直贈表單要提前
  // 隱藏（對應的 mutation API 本身也會回 409，這裡只是避免使用者送出後才看到衝突錯誤）。
  const lottery = await db.lottery.findUnique({
    where: { itemId: item.id },
    select: { status: true },
  });
  const lotteryActive =
    lottery?.status === "open" ||
    lottery?.status === "drawing" ||
    lottery?.status === "awaiting_confirmation";

  // 感謝留言：只有 completed 之後才可能存在（見 /api/items/[id]/thanks 的檢查），
  // 其他狀態不用多查一次浪費一趟資料庫往返。itemId 有 unique constraint，最多一筆。
  const thanksMessage =
    item.status === "completed"
      ? await db.thanksMessage.findUnique({
          where: { itemId: item.id },
          include: { fromUser: { include: { profile: true } } },
        })
      : null;

  // M10 批次 2（master-plan §10a 交付批次 2）：詳情頁「狀態導向分區層級」重排用的
  // 衍生狀態——不新增查詢，全部從上面已查好的 item.status／isReceiver／thanksMessage
  // 算出，只決定既有 9 個 section 元件要 mount 在哪個區塊（各元件內部邏輯不動）。
  // handoverIsActive：交接正在進行（含尚未開始交接的 reserved），是使用者「現在該做
  // 的事」；completed 之後交接區塊改顯示於下方「歷程」區。
  const handoverIsActive =
    (item.status === "reserved" || item.status === "handover_pending") &&
    (session?.user?.id === item.ownerId || isReceiver);
  // showHistoryZone：completed 狀態下，只有物主／接手者（會看到交接完成訊息或感謝表單）
  // 或已經有感謝留言（任何人都能看）時才顯示「歷程」區塊，避免非相關訪客看到只有標題
  // 沒有內容的空區塊。
  const showHistoryZone =
    item.status === "completed" &&
    (session?.user?.id === item.ownerId || isReceiver || thanksMessage !== null);

  // M9（master-plan §9a 交付內容 3）：優惠券使用結果回報聚合統計，只有優惠券物品才查詢。
  const couponUsageCounts = { usable: 0, expired_or_used: 0 };
  let alreadyReportedUsage = false;
  if (item.couponDetail) {
    const grouped = await db.couponUsageReport.groupBy({
      by: ["result"],
      where: { itemId: item.id },
      _count: { _all: true },
    });
    for (const row of grouped) {
      couponUsageCounts[row.result] = row._count._all;
    }
    if (session?.user) {
      const existing = await db.couponUsageReport.findUnique({
        where: { itemId_reporterId: { itemId: item.id, reporterId: session.user.id } },
        select: { id: true },
      });
      alreadyReportedUsage = existing !== null;
    }
  }

  // SEO/AEO（master-plan §3.7）：物品詳情頁的 Product + Offer 結構化資料。
  const firstImage = item.images[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.title,
    description: item.description,
    ...(firstImage ? { image: [publicUrl(firstImage.mediumObject.objectKey)] } : {}),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "TWD",
      availability: offerAvailability(item.status),
    },
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      {/* Next.js 官方建議的 JSON-LD 寫法：JSON.stringify 已跳脫，另對 "<" 做保險轉義避免斷出 </script> */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 內容來自 JSON.stringify（已跳脫）＋額外 < 轉義，非使用者可控 HTML
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      {item.images.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="relative aspect-[4/3] w-full bg-paper-2">
            <Image
              src={publicUrl(item.images[0].mediumObject.objectKey)}
              alt={item.title}
              fill
              sizes="(min-width: 768px) 768px, 100vw"
              priority
              className="object-cover"
            />
          </div>
          {item.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto border-t border-line bg-card p-2">
              {item.images.map((img) => (
                <div
                  key={img.id}
                  className="relative aspect-square w-16 shrink-0 overflow-hidden rounded-lg bg-paper-2"
                >
                  <Image
                    src={publicUrl(img.thumbObject.objectKey)}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-1.5 text-sm text-ink-soft">
        <MapPin size={14} strokeWidth={2.4} aria-hidden="true" />
        {item.city.name}
        <span className="mx-1">・</span>
        {item.category.name}
      </div>
      {/* 提案 B 字型節奏（見 03-style-proposals.md）：標題字重 600、字距 0，三套裡最中性沉穩的一套 */}
      <h1 className="mt-2 text-2xl font-semibold tracking-normal text-ink">{item.title}</h1>
      <p className="mt-3 whitespace-pre-wrap text-ink-soft">{item.description}</p>

      <div className="mt-6 flex items-center justify-between gap-2 rounded-xl border border-line bg-card p-4 text-sm text-ink-soft">
        <span>
          分享者：
          <Link href={`/u/${item.ownerId}`} className="text-ink underline-offset-2 hover:underline">
            {item.owner.profile?.nickname ?? "好物共享使用者"}
          </Link>
        </span>
        {session?.user && session.user.id !== item.ownerId && (
          <ReportButton target={{ itemId: item.id }} label="檢舉這個物品" />
        )}
      </div>

      {/* M10 批次 2：Zone 2「物品詳細資訊」——描述物品本身性質的參考資訊（券/票/點數），
          quiet 排版（無獨立卡片外框、標題改小寫細字），不是行動項目。這個 <div> 本身提供
          與上方分享者資訊列的分隔線，個別 section 靠 first:border-t-0 避免雙重分隔線。 */}
      <div className="mt-8 border-t border-line pt-6">
        <CouponSection
          itemId={item.id}
          coupon={
            item.couponDetail
              ? {
                  faceValue: item.couponDetail.faceValue,
                  merchantName: item.couponDetail.merchantName,
                  notes: item.couponDetail.notes,
                  expiresAt: item.expiresAt,
                }
              : null
          }
          canReveal={
            isReceiver && (item.status === "handover_pending" || item.status === "completed")
          }
        />
        {item.couponDetail && (
          <CouponUsageSection
            itemId={item.id}
            usableCount={couponUsageCounts.usable}
            expiredCount={couponUsageCounts.expired_or_used}
            canReport={
              isReceiver && (item.status === "handover_pending" || item.status === "completed")
            }
            alreadyReported={alreadyReportedUsage}
          />
        )}
        <TicketSection
          ticket={
            item.ticketDetail
              ? {
                  ticketType: item.ticketDetail.ticketType,
                  originPlatform: item.ticketDetail.originPlatform,
                  eventName: item.ticketDetail.eventName,
                  expiresAt: item.expiresAt,
                }
              : null
          }
        />
        <PointSection
          point={
            item.pointDetail
              ? {
                  pointPlatform: item.pointDetail.pointPlatform,
                  pointAmount: item.pointDetail.pointAmount,
                }
              : null
          }
        />
      </div>

      {/* M10 批次 2：Zone 3「互動與交接」——把留言/直贈/抽籤/交接（進行中）合併成單一
          卡片外框，取代過去每個功能各自一張近乎相同外觀的卡片（impeccable「identical
          card grids」問題）。交接進行中時在最前面加「現在可以做的事」提示，優先突出當前
          最需要處理的行動；其餘三個功能維持既有邏輯與顯示條件不變，只是外框從各自獨立
          改成共用同一張卡片、以分隔線區隔。 */}
      <div className="mt-8 space-y-5 rounded-2xl border border-line bg-card p-5 sm:p-6">
        {handoverIsActive && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
              現在可以做的事
            </p>
            <div className="mt-3">
              <HandoverSection
                itemId={item.id}
                itemStatus={item.status}
                isOwner={session?.user?.id === item.ownerId}
                isReceiver={isReceiver}
                handoverId={handoverId}
                conversationId={conversationId}
                hasThanks={thanksMessage !== null}
              />
            </div>
          </div>
        )}
        <LotterySection
          itemId={item.id}
          itemStatus={item.status}
          isOwner={session?.user?.id === item.ownerId}
          isLoggedIn={!!session?.user}
        />
        <DirectShareSection
          itemId={item.id}
          itemStatus={item.status}
          isOwner={session?.user?.id === item.ownerId}
          lotteryActive={lotteryActive}
        />
        <ClaimsSection
          itemId={item.id}
          itemStatus={item.status}
          currentUserId={session?.user?.id}
          lotteryActive={lotteryActive}
        />
      </div>

      {/* M10 批次 2：Zone 4「歷程」——完成分享後的紀錄（交接完成訊息／感謝留言），
          收合到頁面最後、quiet 排版，呼應 master-plan §10a「歷程/感謝收合或後置」。 */}
      {showHistoryZone && (
        <div className="mt-10 border-t border-line pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-disabled">歷程</p>
          <div className="mt-3">
            <HandoverSection
              itemId={item.id}
              itemStatus={item.status}
              isOwner={session?.user?.id === item.ownerId}
              isReceiver={isReceiver}
              handoverId={handoverId}
              conversationId={conversationId}
              hasThanks={thanksMessage !== null}
            />
            <ThanksSection
              thanks={
                thanksMessage
                  ? {
                      message: thanksMessage.message,
                      createdAt: thanksMessage.createdAt,
                      fromNickname: thanksMessage.fromUser.profile?.nickname ?? "好物共享使用者",
                    }
                  : null
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
