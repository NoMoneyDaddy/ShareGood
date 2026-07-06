import type { Metadata } from "next";
import { auth } from "@/auth";
import { LegalDraftNotice } from "@/components/legal-draft-notice";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// 隱私權政策：呼應 master-plan.md §1 non-goals（只收 email/暱稱/縣市/Google 帳號基本
// 資料，不收真實姓名/電話/地址/GPS/身分證/生日）。附上 LegalDraftNotice 起草警語，
// 並包含「未來若導入 Google 廣告服務將更新本頁」的前瞻條款，為日後串接 Google Ads 鋪路。
const SECTIONS = [
  {
    heading: "一、我們蒐集哪些資訊",
    body: "登入時，我們會透過 Google OAuth 取得你的 email 與 Google 帳號提供的基本資料（如顯示名稱、大頭貼）。完成 onboarding 後，我們會儲存你自行填寫的暱稱與所在縣市。此外，我們會儲存你在平台上的使用內容，例如上架物品的照片與文字說明、留言、私訊訊息、感謝留言等。\n\n我們不會蒐集你的真實姓名、電話號碼、實體地址、GPS 定位、身分證字號或生日等敏感個資，這是 ShareGood 產品定位上的明確承諾，不只是目前技術限制。",
  },
  {
    heading: "二、資訊用途",
    body: "上述資訊僅用於提供本平台的核心服務：帳號驗證與登入、物品上架與媒合、留言與直贈流程、交接私訊、站內通知，以及防止濫用與違規處理。我們不會將你的個人資料用於本平台服務以外的用途，也不會出售給第三方。",
  },
  {
    heading: "三、資訊儲存與安全",
    body: "帳號資料儲存於 PostgreSQL 資料庫，物品圖片等大型檔案儲存於獨立的物件儲存服務（MinIO），皆非公開直接存取；我們不經手也不儲存你的 Google 帳號密碼，登入驗證完全由 Google 負責。",
  },
  {
    heading: "四、第三方服務揭露",
    body: "本平台目前使用以下第三方服務：Google（提供 OAuth 登入驗證）。物品圖片透過 MinIO 物件儲存服務保存。這些服務僅用於支援平台運作，我們會在導入新的第三方服務時更新本頁說明。",
  },
  {
    heading: "五、Cookie 與追蹤技術",
    body: "目前本站僅使用維持登入狀態所必要的 Cookie（session cookie），不使用任何第三方廣告或分析用 Cookie。\n\n前瞻條款：若未來導入相關服務（例如 Google 廣告服務），將於本頁更新說明並依法取得必要同意。",
  },
  {
    heading: "六、使用者權利",
    body: "你可以隨時自行修改暱稱與所在縣市等個人設定。若需要刪除帳號或有其他個資疑問，目前請聯繫站方協助處理；正式的自助資料匯出與刪除功能規劃於平台後續版本提供。",
  },
  {
    heading: "七、資料保留",
    body: "你的帳號資料在帳號存續期間會持續保留，用以支援平台的共享紀錄與貢獻值功能。帳號刪除後的資料保留與清除方式，將於平台後續版本明確化為正式政策。",
  },
  {
    heading: "八、政策修訂",
    body: "我們可能不時修訂本隱私權政策，修訂後將公告於本頁並更新最後更新日期；重大變更會另行於站內公告提醒使用者。",
  },
  {
    heading: "九、聯絡方式",
    body: "如對本政策有任何疑問，歡迎透過站內既有的登入帳號聯繫站方；正式的客服聯絡管道將於平台發展過程中逐步補齊。",
  },
];

export const metadata: Metadata = {
  title: "隱私權政策",
  description: "ShareGood 好物共享隱私權政策：我們蒐集哪些資訊、如何使用，以及你的相關權利。",
};

export default async function PrivacyPage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={profile} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">隱私權政策</h1>
        <p className="mt-2 text-ink-soft">最後更新：2026 年 7 月</p>

        <div className="mt-6">
          <LegalDraftNotice />
        </div>

        <div className="mt-8 flex flex-col divide-y divide-line">
          {SECTIONS.map((section) => (
            <div key={section.heading} className="py-6 first:pt-0">
              <h2 className="text-lg font-bold tracking-tight">{section.heading}</h2>
              <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink-soft">
                {section.body}
              </p>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
