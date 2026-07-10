import { Compass, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "找不到頁面" };

// 全站 404 頁（使用者實測回饋：深頁缺少導覽退路）。這是 Next.js App Router 的根層級
// not-found.tsx——任何巢狀路由呼叫 notFound()、或造訪不存在的網址，只要該路由段沒有
// 自己的 not-found.tsx（目前沒有任何子路由自訂），最終都會 bubble 到這裡，且只會被包在
// RootLayout 裡（不含 (shell) route group 的 SiteHeader／BottomTab），所以這頁刻意做成
// 自成一體、置中的畫面，不依賴殼層元件。視覺比照 empty-state.tsx（圖示＋標題＋說明＋
// 主要行動按鈕）的排版慣例，只是尺寸放大成全頁版本。
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-4 py-16 text-center text-ink">
      <div
        className="flex size-16 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
        aria-hidden="true"
      >
        <Compass size={28} strokeWidth={1.75} />
      </div>
      <p className="mt-6 text-sm font-semibold tracking-wide text-brand-ink">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">這裡好像沒有東西</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">
        你要找的頁面不存在，或者已經被移除了。要不要回首頁，或去逛逛還在分享中的好物？
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild variant="brand" size="xl">
          <Link href="/">
            <Home size={18} strokeWidth={2.2} aria-hidden="true" />
            回首頁
          </Link>
        </Button>
        <Button asChild variant="outline" size="xl">
          <Link href="/items">逛好物</Link>
        </Button>
      </div>
    </div>
  );
}
