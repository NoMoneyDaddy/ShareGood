import type { Metadata } from "next";
import { auth } from "@/auth";
import { LegalDraftNotice } from "@/components/legal-draft-notice";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// 服務條款：呼應 master-plan.md §1 non-goals（不做金流/物流保障，交接風險由雙方自行負責）。
// 附上 LegalDraftNotice 起草警語（§12 上線前檢查表要求）。這頁不是問答式結構——
// §3.7 只要求 /guide、/rules 用 FAQPage 結構，/terms、/privacy 用一般條列式即可。
const SECTIONS = [
  {
    heading: "一、服務範圍與定位",
    body: "ShareGood 好物共享（以下稱「本平台」）是台灣縣市級的免費物品共享服務，讓使用者可以把用不到但還能使用的物品，分享給有需要的人。本平台不提供、也不允許任何形式的買賣、交換或以物易物，不介入金流與物流，也不經營鄰里社區群組功能。使用本平台即表示你同意僅將其用於免費分享物品的用途。",
  },
  {
    heading: "二、帳號與資格",
    body: "使用本平台須以 Google 帳號登入並完成暱稱與所在縣市的設定。你須對自己帳號下的所有活動負責，並妥善保管登入憑證；如發現帳號遭盜用，請儘速透過站方管道聯繫處理。本平台保留在合理懷疑帳號濫用時暫停或限制帳號功能的權利。",
  },
  {
    heading: "三、使用者責任",
    body: "上架物品時，你必須確保物品資訊真實正確、擁有合法處分該物品的權利，並遵守〈使用規則〉（/rules）中禁止品項與即期食品規範。你不得在留言、直贈或私訊過程中要求或暗示對方付費、補差價或以物易物；不得張貼違法、仿冒、危險或不實內容；不得騷擾其他使用者。",
  },
  {
    heading: "四、交接風險與平台免責聲明",
    body: "本平台僅提供媒合（上架、留言、直贈）與交接前的站內私訊功能，實際交接的時間、地點與方式由分享者與接手者雙方自行約定，本平台不參與、不監督、也不保證交接過程的安全性。任何因交接產生的糾紛、財物損失、人身傷害或其他損害，應由雙方自行協調解決，本平台不承擔相關法律責任。建議使用者選擇公開、安全的地點進行面交。",
  },
  {
    heading: "五、內容授權",
    body: "你上傳至本平台的物品照片與文字說明，其著作權仍歸你所有；但你同意授權本平台在提供共享媒合服務的必要範圍內（例如顯示於物品列表、詳情頁、搜尋結果、社群分享的預覽圖）使用、重製與公開傳輸這些內容。",
  },
  {
    heading: "六、違規處理",
    body: "如使用者違反本條款或〈使用規則〉，本平台得視情節輕重下架相關物品、限制帳號部分功能（例如禁止上架、留言或私訊）或封鎖帳號，並可能於處理前後通知當事人。相關治理機制（檢舉、申訴）將隨平台發展逐步完整。",
  },
  {
    heading: "七、服務變更、暫停與終止",
    body: "本平台為免費服務，不保證全天候不中斷運作，得因維護、升級或其他營運考量暫停、變更或終止部分或全部服務，將盡力提前於站內公告。",
  },
  {
    heading: "八、準據法與管轄",
    body: "本條款以中華民國法律為準據法。因本條款所生之爭議，雙方同意以台灣台北地方法院為第一審管轄法院。",
  },
  {
    heading: "九、條款修訂",
    body: "本平台得不時修訂本條款，修訂後將公告於本頁並更新生效日期；持續使用本平台視為同意修訂後的條款。",
  },
  {
    heading: "十、聯絡方式",
    body: "如對本條款有任何疑問，歡迎透過站內既有的登入帳號聯繫站方；正式的客服聯絡管道將於平台發展過程中逐步補齊。",
  },
];

export const metadata: Metadata = {
  title: "服務條款",
  description: "ShareGood 好物共享服務條款：使用者責任、平台免責聲明與服務變更說明。",
};

export default async function TermsPage() {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={profile} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">服務條款</h1>
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
