// 感謝留言顯示區塊：純顯示用的 server component，資料由 page.tsx 一次查好往下傳
// （比照 Wave 1/2 其他 section 的做法，只在 page.tsx 加一行 import + 一行元件掛載）。
// 任何人（含未登入訪客）都能在物品詳情頁看到這則感謝留言，不限物主本人。

type ThanksSectionProps = {
  thanks: { message: string; createdAt: Date; fromNickname: string } | null;
};

function formatTime(date: Date) {
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export function ThanksSection({ thanks }: ThanksSectionProps) {
  if (!thanks) return null;

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-disabled uppercase tracking-wide">感謝留言</h2>
      <div className="mt-3">
        <p className="whitespace-pre-wrap text-sm text-ink">{thanks.message}</p>
        <p className="mt-2 text-xs text-ink-soft">
          {thanks.fromNickname}・{formatTime(thanks.createdAt)}
        </p>
      </div>
    </section>
  );
}
