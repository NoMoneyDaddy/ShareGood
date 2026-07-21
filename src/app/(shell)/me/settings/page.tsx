import type { Metadata } from "next";
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
