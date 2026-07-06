import type { Metadata } from "next";
import { auth } from "@/auth";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// 新手說明頁：master-plan.md §3.7 要求問答式標題結構（H2 提問、段落作答）方便 AEO
// 答案引擎摘錄，並用 FAQPage JSON-LD 結構化資料（§11.6 頁面地圖、§12 上線前檢查表）。
// 內容只涵蓋 M1 已實作的功能（上架、留言認領、直贈、私訊交接、感謝與貢獻值），
// 刻意不提抽籤（M5，尚未實作也未獲使用者確認）與檢舉技術細節（M2）。
const FAQS = [
  {
    question: "ShareGood 是什麼樣的平台？",
    answer:
      "ShareGood 好物共享是台灣縣市級的免費共享平台，讓你把用不到但還能用的物品，直接分享給剛好需要的人。平台不做金流、不做物流、不做交換，也不經營社區圈，單純幫「想分享的人」與「需要的人」搭起一座橋。",
  },
  {
    question: "我要怎麼上架一個物品？",
    answer:
      "點選首頁或底部導覽的「分享」按鈕，進入分步驟表單：先填寫物品標題、分類、所在縣市與說明文字，再上傳最多 5 張照片（支援 iPhone 拍照常見的 HEIC 格式，系統會自動轉檔），最後確認送出即會立刻發布，任何人都能在物品列表看到。",
  },
  {
    question: "別人想要我分享的物品，要怎麼「認領」？",
    answer:
      "已登入的使用者可以在物品詳情頁留言表達「我需要」。目前採先到先得模式：第一則留言會自動被系統接受，物品狀態轉為「保留中」，其他人就無法再留言認領同一件物品。",
  },
  {
    question: "除了留言認領，還有其他接手方式嗎？",
    answer:
      "有，分享者也可以選擇「直贈」：直接指定某一位使用者（輸入對方的 email）把物品贈與給他，對方會收到通知，可以在期限內（72 小時）選擇接受或婉拒，逾時則自動失效，分享者可以再重新選擇接手的人。",
  },
  {
    question: "物品確定要交給我之後，接下來怎麼約時間地點？",
    answer:
      "系統會自動幫雙方開一個一對一的私訊對話（可以在「訊息」分頁或物品詳情頁進入），你們可以在裡面約定交接的時間與地點，交接前不需要公開電話、地址等個人資料。",
  },
  {
    question: "交接完成後要做什麼？",
    answer:
      "雙方各自到物品詳情頁按下「標記完成」，等對方也確認之後，物品狀態就會變成「已完成」。如果約好的接手者一直沒有出現，分享者可以標記「未出現」，物品會退回可分享的狀態，讓分享者重新找人接手。",
  },
  {
    question: "什麼是感謝留言與貢獻值？",
    answer:
      "物品完成共享後，接手者可以留一則感謝留言給分享者（每個物品限一則）。同時系統會自動記錄貢獻值：分享者完成一次分享會加分最多、接手者完成接手也會加分，若接手者被標記未出現則會扣分。累積的貢獻值會顯示在你的個人頁面，是你在 ShareGood 上熱心程度的紀錄。",
  },
];

export const metadata: Metadata = {
  title: "新手指南",
  description:
    "從上架到完成交接，一次搞懂 ShareGood 好物共享的使用方式：怎麼分享物品、留言認領與直贈的差別、私訊交接、感謝留言與貢獻值。",
};

export default async function GuidePage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  // SEO/AEO（master-plan §3.7）：/guide 用 FAQPage JSON-LD，寫法比照物品詳情頁
  // 既有的 Product/Offer JSON-LD 慣例（JSON.stringify 已跳脫，另對 "<" 做保險轉義）。
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
        <h1 className="text-3xl font-bold tracking-tight">新手指南</h1>
        <p className="mt-2 text-ink-soft">
          第一次使用 ShareGood 嗎？這裡整理了從上架到完成共享的完整流程。
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
