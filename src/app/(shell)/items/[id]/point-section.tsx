// 點數資訊顯示區塊（master-plan.md §9a 交付內容 5）：純顯示用的 server component，
// 資料由 page.tsx 一次查好往下傳（比照 thanks-section.tsx 等既有 section 慣例）。
// 定位是「無償贈與媒合＋引導官方閉環」——平台不經手點數本身，這個區塊標配官方為準警示與
// 個資最小化提醒（研究 04 必寫清單，草案，需律師審閱）。

type PointInfo = {
  pointPlatform: string;
  pointAmount: number;
};

export function PointSection({ point }: { point: PointInfo | null }) {
  if (!point) return null;

  return (
    <section id="point" className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">點數資訊</h2>
      <div className="mt-4 space-y-2 rounded-xl border border-line bg-card p-4 text-sm">
        <p className="text-ink">
          點數平台：<span className="font-medium">{point.pointPlatform}</span>
        </p>
        <p className="text-ink">
          點數數量：<span className="font-medium">{point.pointAmount.toLocaleString("zh-TW")}</span>
        </p>

        {/* M10 批次 2：改用 text-ink，理由同 ticket-section.tsx 的相同修正註解
            （text-brand-ink 疊 bg-brand-soft 在暗色模式下對比不足 4.5:1）。 */}
        <div className="mt-3 space-y-2 rounded-lg border border-brand/30 bg-brand-soft p-3 text-xs text-ink">
          <p>
            點數轉贈依各平台官方規則，能否轉贈、次數與期限以官方 App
            為準；本平台不經手點數。實際轉移請雙方一律走官方 App 的轉贈功能完成。
          </p>
          <p>請勿在留言或私訊中提供會員帳號、手機號碼、簡訊驗證碼等個人資料。</p>
          <p className="text-ink-soft/80">
            本平台所提及之商店名稱、品牌及商標均屬各權利人所有；除另有標示外，本平台與各品牌並無合作、授權或從屬關係。
          </p>
        </div>
      </div>
    </section>
  );
}
