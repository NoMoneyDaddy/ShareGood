import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { ItemStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/storage";
import { ClaimsSection } from "./claims-section";
import { CouponSection } from "./coupon-section";
import { DirectShareSection } from "./direct-share-section";
import { HandoverSection } from "./handover-section";
import { ThanksSection } from "./thanks-section";

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
  if (!item || item.status === "removed_by_moderator") return {};
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
export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [item, session] = await Promise.all([getItem(id), auth()]);
  if (!item || item.status === "removed_by_moderator") notFound();

  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

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

  // 感謝留言：只有 completed 之後才可能存在（見 /api/items/[id]/thanks 的檢查），
  // 其他狀態不用多查一次浪費一趟資料庫往返。itemId 有 unique constraint，最多一筆。
  const thanksMessage =
    item.status === "completed"
      ? await db.thanksMessage.findUnique({
          where: { itemId: item.id },
          include: { fromUser: { include: { profile: true } } },
        })
      : null;

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
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      {/* Next.js 官方建議的 JSON-LD 寫法：JSON.stringify 已跳脫，另對 "<" 做保險轉義避免斷出 </script> */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 內容來自 JSON.stringify（已跳脫）＋額外 < 轉義，非使用者可控 HTML
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader session={session} profile={profile} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{item.title}</h1>
        <p className="mt-3 whitespace-pre-wrap text-ink-soft">{item.description}</p>

        <div className="mt-6 rounded-xl border border-line bg-card p-4 text-sm text-ink-soft">
          分享者：
          <Link href={`/u/${item.ownerId}`} className="text-ink underline-offset-2 hover:underline">
            {item.owner.profile?.nickname ?? "好物共享用戶"}
          </Link>
        </div>

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

        <DirectShareSection
          itemId={item.id}
          itemStatus={item.status}
          isOwner={session?.user?.id === item.ownerId}
        />
        <ClaimsSection itemId={item.id} itemStatus={item.status} />
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
                  fromNickname: thanksMessage.fromUser.profile?.nickname ?? "好物共享用戶",
                }
              : null
          }
        />
      </main>

      <SiteFooter />
    </div>
  );
}
