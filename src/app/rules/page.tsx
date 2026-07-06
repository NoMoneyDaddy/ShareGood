import type { Metadata } from "next";
import { auth } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// 使用規則頁：內容呼應 master-plan.md §1（產品定位與 non-goals）與 §8（即期食品規則）。
// 刻意不寫死 M2 檢舉技術細節（尚未實作），也不提抽籤（M5，尚未獲使用者確認）。
const FAQS = [
  {
    question: "ShareGood 是免費的嗎？可以在上面買賣或交換東西嗎？",
    answer:
      "ShareGood 是純粹的免費共享平台，站上所有物品一律免費贈送，不提供、也不允許任何形式的買賣、交換或以物易物。如果你在留言、私訊或交接過程中被要求付款、補差價、支付運費或用其他物品交換，這已經違反使用規則。",
  },
  {
    question: "為什麼不能私下約對方付一點「車馬費」或「處理費」？",
    answer:
      "即使雙方你情我願，只要牽涉到任何金錢往來，就脫離了「免費共享」的平台定位，也可能演變成變相買賣或詐騙的溫床。ShareGood 選擇完全不碰金流，是為了讓每一次分享都單純、安全，請不要在私訊裡跟對方談錢。",
  },
  {
    question: "平台會幫忙寄送或代收物品嗎？",
    answer:
      "不會。ShareGood 不介入物流，交接的時間、地點與方式完全由分享者與接手者兩人自行約定。請盡量選擇公開、安全的地點面交，並自行評估交接過程中的風險；平台不對交接過程中發生的任何糾紛或損失負責。",
  },
  {
    question: "什麼是「社區圈」，為什麼平台不做？",
    answer:
      "ShareGood 刻意不經營鄰里社群、留言板或群組聊天室這類「社區圈」功能，分享的範圍最細只到縣市，是為了讓平台維持單純的共享媒合工具，不介入使用者之間的社交關係。",
  },
  {
    question: "哪些物品不能上架？",
    answer:
      "請不要上架違禁品（例如管制刀械、槍砲、毒品）、需要特殊證照或執照才能持有或轉讓的物品（例如處方藥、醫療器材）、仿冒或侵權商品、危險品（易燃易爆物、腐蝕性化學物質）、以及任何可能違反法令的物品。如果不確定某項物品能不能上架，請優先選擇不要分享。",
  },
  {
    question: "分享即期食品有什麼規定？",
    answer:
      "分享食品類物品時，僅限「完整包裝、未開封、常溫保存、且尚未過期」的品項才能上架，上架時請務必如實填寫到期日，不要分享已經過期或需要冷藏冷凍保存的食品，保障接手者的食用安全。",
  },
  {
    question: "如果遇到違規行為或糾紛，該怎麼辦？",
    answer:
      "目前遇到問題，可以先透過私訊與對方溝通；平台未來會提供正式的站內檢舉機制，讓違規物品、留言或私訊都能被舉報處理。在正式上線前，如果遇到嚴重問題，歡迎直接聯繫站方協助處理。",
  },
];

export const metadata: Metadata = {
  title: "使用規則",
  description:
    "在分享或接手好物之前，先了解 ShareGood 的平台定位、禁止行為、禁止品項與即期食品安全規範。",
};

export default async function RulesPage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  // SEO/AEO（master-plan §3.7）：/rules 同 /guide 一併提供 FAQPage JSON-LD。
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD 內容來自 JSON.stringify（已跳脫）＋額外 < 轉義，非使用者可控 HTML
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader session={session} profile={profile} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">使用規則</h1>
        <p className="mt-2 text-ink-soft">
          ShareGood 是免費共享平台，這裡說明平台定位、禁止行為與品項規範。
        </p>

        <div className="mt-8 flex flex-col divide-y divide-line">
          {FAQS.map((faq) => (
            <div key={faq.question} className="py-6 first:pt-0">
              <h2 className="text-lg font-bold tracking-tight">{faq.question}</h2>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink-soft">{faq.answer}</p>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
