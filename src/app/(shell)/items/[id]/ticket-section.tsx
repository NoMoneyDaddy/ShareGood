// 票券資訊顯示區塊（master-plan.md §9a 交付內容 4）：純顯示用的 server component，
// 資料由 page.tsx 一次查好往下傳（比照 thanks-section.tsx 等既有 section 慣例）。
// 這是「資訊型媒合」定位——平台只顯示發布者聲明的券種/原平台資訊，不碰票、不擔保，
// 因此法定警示與轉贈風險提示（研究 04 必寫清單，草案，需律師審閱）標配顯示在這個區塊。

type TicketInfo = {
  ticketType: string;
  originPlatform: string;
  eventName: string | null;
  expiresAt: Date | null;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

// KKTIX 等有官方轉讓閉環的平台：偵測到就顯示「走官方轉讓」的額外說明（研究 02 票券轉贈
// 官方規則表）；只做子字串比對，不是完整清單，未來若要擴充其他平台再加。
function hasOfficialTransferFlow(originPlatform: string): boolean {
  return originPlatform.toLowerCase().includes("kktix");
}

export function TicketSection({ ticket }: { ticket: TicketInfo | null }) {
  if (!ticket) return null;

  return (
    <section id="ticket" className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">票券資訊</h2>
      <div className="mt-4 space-y-2 rounded-xl border border-line bg-card p-4 text-sm">
        <p className="text-ink">
          券種：<span className="font-medium">{ticket.ticketType}</span>
        </p>
        <p className="text-ink">
          原平台：<span className="font-medium">{ticket.originPlatform}</span>
        </p>
        {ticket.eventName && <p className="text-ink-soft">活動名稱：{ticket.eventName}</p>}
        {ticket.expiresAt && (
          <p className="text-ink-soft">使用期限：{formatDate(ticket.expiresAt)}</p>
        )}

        {hasOfficialTransferFlow(ticket.originPlatform) && (
          <p className="rounded-lg bg-paper-2 px-3 py-2 text-xs text-ink-soft">
            此平台提供官方轉讓功能，請雙方走官方流程完成轉讓，本平台僅協助媒合、不碰票。
          </p>
        )}

        {/* M10 批次 2：改用 text-ink（而非 text-brand-ink）——換裝提案 B 後，深色模式下
            text-brand-ink 疊在 bg-brand-soft 上實測僅約 4.15:1，未達 4.5:1 AA 門檻；
            ink 疊 brand-soft 才是研究文件驗證過的高對比組合（12.44:1），見 globals.css
            --color-brand-soft 註解。 */}
        <div className="mt-3 space-y-2 rounded-lg border border-brand/30 bg-brand-soft p-3 text-xs text-ink">
          <p>
            依文創法第 10 條之 1 及運動產業發展條例第 24 條之 1，以超過票面金額轉售票券可處票面 10
            至 50 倍罰鍰。本平台僅允許無償轉贈。
          </p>
          <p>
            本平台僅提供無償轉贈之資訊媒合，不經手、不保管、不擔保任何票券或優惠券之真偽與可兌換性；能否轉讓請依發行人使用條款。
          </p>
          <p>優惠與兌換條件可能隨時變動，實際內容以發行商家最新公告及現場為準。</p>
          <p className="text-ink-soft/80">
            本平台所提及之商店名稱、品牌及商標均屬各權利人所有；除另有標示外，本平台與各品牌並無合作、授權或從屬關係。
          </p>
        </div>
      </div>
    </section>
  );
}
