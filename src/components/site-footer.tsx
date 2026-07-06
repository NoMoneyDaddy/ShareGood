import Link from "next/link";

// 全站共用頁尾：確保 /guide、/rules、/terms、/privacy 這四個靜態頁在任何掛載這個
// 元件的頁面上都有明顯入口，不會變成「網址存在但沒有導覽點得到」的孤兒頁
// （master-plan.md §11.6、§12 上線前檢查表第一條）。
const FOOTER_LINKS = [
  { href: "/guide", label: "新手指南" },
  { href: "/rules", label: "使用規則" },
  { href: "/terms", label: "服務條款" },
  { href: "/privacy", label: "隱私權政策" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper-2 pb-24 md:pb-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-soft sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-bold text-ink">好物共享 ShareGood</span>
          <span>台灣縣市級免費共享平台。不做金流、不做物流、不做交換。</span>
        </div>
        <nav aria-label="頁尾連結" className="flex flex-wrap gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-ink-soft underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
