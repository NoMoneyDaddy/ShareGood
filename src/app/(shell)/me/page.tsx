import {
  Bell,
  Heart,
  type LucideIcon,
  Settings,
  ShieldCheck,
  Ticket,
  Trophy,
  UserCircle,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isModeratorOrAdmin } from "@/lib/support-tickets";
import { PwaInstallCard } from "./pwa-install-card";
import { RestartTourButton } from "./restart-tour-button";

export const metadata: Metadata = { title: "我的" };

type MeCard = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

// 「我的」中心頁（M11，使用者實測回饋第 3／4 項：「我的需要」跟「優惠券錢包」分不清、
// 錢包/通知設定/我的訂閱入口不明顯）。這裡不重新發明任何功能，純粹把既有分散的入口
// （/me/wallet、/me/subscriptions、/me/notification-preferences、/me/settings、
// /u/[userId]）集中一處，每項都用白話說明它「解決什麼問題」而不是只寫功能名稱——
// 這正是使用者反饋「分不清楚」的直接對策：訂閱通知卡片的說明句就是原本「我的需要」
// 想表達的意思（關鍵字/縣市訂閱），不再需要底部導覽另外留一個難懂的分頁。
export default async function MePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const [profile, user] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.user.findUnique({ where: { id: userId }, include: { roles: true } }),
  ]);
  const canModerate = user ? isModeratorOrAdmin(user) : false;

  const cards: MeCard[] = [
    {
      href: "/leaderboard",
      icon: Trophy,
      title: "貢獻排行榜",
      description: "看看誰是最熱心的分享鄰居，也看看自己排第幾名。",
    },
    {
      href: "/me/wallet",
      icon: Ticket,
      title: "優惠券錢包",
      description: "你分享出去和接手到的券都在這。",
    },
    {
      href: "/me/favorites",
      icon: Heart,
      title: "我的收藏",
      description: "收藏的物品被接走或即將到期，我們會提醒你。",
    },
    {
      href: "/me/subscriptions",
      icon: Bell,
      title: "訂閱通知",
      description: "設定關鍵字、縣市，有新好物立刻通知你。",
    },
    {
      href: "/me/notification-preferences",
      icon: Settings,
      title: "通知設定",
      description: "站內通知、外部通知（Telegram）分別要不要收，自己決定。",
    },
    {
      href: "/me/settings",
      icon: ShieldCheck,
      title: "帳號設定",
      description: "匯出你的資料、或是刪除帳號，都在這裡處理。",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">我的</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {profile?.nickname ?? session.user?.name ?? "朋友"}，這裡是你的所有設定與紀錄。
      </p>

      {!profile && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft p-4">
          <p className="text-sm font-medium text-ink">還沒完成基本資料設定</p>
          <p className="mt-1 text-sm text-ink-soft">設定暱稱與所在縣市，才能開始分享與接手好物。</p>
          <Link
            href="/onboarding"
            className="mt-2 inline-flex text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
          >
            前往設定 →
          </Link>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <PwaInstallCard />

        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
              aria-hidden="true"
            >
              <card.icon size={19} strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">{card.title}</span>
              <span className="block text-xs text-ink-soft">{card.description}</span>
            </span>
          </Link>
        ))}

        {profile && (
          <Link
            href={`/u/${userId}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
              aria-hidden="true"
            >
              <UserCircle size={19} strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">我的個人頁</span>
              <span className="block text-xs text-ink-soft">看看你的暱稱與累計貢獻值。</span>
            </span>
          </Link>
        )}

        <RestartTourButton />

        {canModerate && (
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-xl border border-line bg-card p-4 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-soft"
              aria-hidden="true"
            >
              <ShieldCheck size={19} strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">後台管理</span>
              <span className="block text-xs text-ink-soft">
                檢舉／申訴／使用者限制等治理工具（moderator/admin）。
              </span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
