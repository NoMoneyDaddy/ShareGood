import { auth } from "@/auth";
import { BottomTab } from "@/components/bottom-tab";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

// 前台共用殼層（M10 批次 1）：SiteHeader＋main＋SiteFooter＋BottomTab 由這個 route group
// layout 強制套用，修復先前 18+ 個頁面各自手動組裝、系統性遺漏殼層的問題（見
// docs/research/2026-07-07-frontend-refactor/02-current-state-design-audit.md）。
// admin/* 與法務頁（terms/privacy/rules/guide，已有自己手動組裝的 header+footer）
// 刻意排除在這個 route group 之外，維持現狀。
//
// auth() 是 NextAuth v5 提供、以 React cache() 包裝的函式：同一個請求裡這裡呼叫一次、
// 底下的 page.tsx 再呼叫一次不會產生第二次真正的 session 查詢（各頁保留自己的
// `await auth()` 是因為頁面內容本身也需要 session/profile 判斷擁有者權限等，不是重複查詢）。
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const profile = session?.user
    ? await db.profile.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper text-ink">
      <SiteHeader session={session} profile={profile} />
      <main className="flex-1 pb-24 md:pb-0">{children}</main>
      <SiteFooter hasBottomTab />
      <BottomTab />
    </div>
  );
}
