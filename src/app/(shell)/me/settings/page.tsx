import { ChevronRight, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { DeleteAccountSection } from "./delete-account-section";
import { ExportDataSection } from "./export-data-section";
import { LeaderboardOptOutSection } from "./leaderboard-optout-section";

export const metadata: Metadata = { title: "帳號與隱私設定" };

// /me/settings（master-plan §7a 交付內容 7）：資料匯出／帳號刪除的自助入口，
// 對應台灣個資法對資料當事人「查詢、閱覽、複製、刪除」權利的基本技術支援。
export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [latestExport, latestDeletion, profile] = await Promise.all([
    db.dataExport.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.privacyRequest.findFirst({
      where: { userId, type: "account_deletion" },
      orderBy: { createdAt: "desc" },
    }),
    db.profile.findUnique({ where: { userId } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">帳號與隱私設定</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        管理你在 ShareGood 留下的資料，對應個資法賦予你的查詢、複製與刪除權利。
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink-soft">匯出我的資料</h2>
        <div className="mt-3">
          <ExportDataSection
            latest={
              latestExport
                ? {
                    id: latestExport.id,
                    status: latestExport.status,
                    requestedAt: latestExport.requestedAt.toISOString(),
                    readyAt: latestExport.readyAt ? latestExport.readyAt.toISOString() : null,
                    expiresAt: latestExport.expiresAt ? latestExport.expiresAt.toISOString() : null,
                  }
                : null
            }
          />
        </div>
      </section>

      {profile && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink-soft">排行榜顯示</h2>
          <div className="mt-3">
            <LeaderboardOptOutSection
              nickname={profile.nickname}
              cityId={profile.cityId}
              initialOptOut={profile.leaderboardOptOut}
            />
          </div>
        </section>
      )}

      {/* M12（docs/plan/m12-product-growth.md 交付內容 3）：封鎖名單是低頻功能，不佔用
          /me 首頁卡片版位，掛在這個頁面裡的一個區塊連結過去（規格明定的入口位置）。 */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">封鎖名單</h2>
        <Link
          href="/me/blocked-users"
          className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
            aria-hidden="true"
          >
            <ShieldOff size={19} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">管理封鎖名單</span>
            <span className="block text-xs text-ink-soft">
              被你封鎖的人無法對你的物品留言或收到你的直贈邀請。
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />
        </Link>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-soft">刪除我的帳號</h2>
        <div className="mt-3">
          <DeleteAccountSection
            latest={
              latestDeletion
                ? {
                    id: latestDeletion.id,
                    status: latestDeletion.status,
                    coolingOffUntil: latestDeletion.coolingOffUntil
                      ? latestDeletion.coolingOffUntil.toISOString()
                      : null,
                  }
                : null
            }
          />
        </div>
      </section>
    </div>
  );
}
