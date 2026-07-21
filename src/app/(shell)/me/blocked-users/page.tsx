import { ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BackBar } from "@/components/back-bar";
import { EmptyState } from "@/components/empty-state";
import { db } from "@/lib/db";
import { BlockedUserRow } from "./blocked-user-row";

export const metadata: Metadata = { title: "封鎖名單" };

const PAGE_SIZE = 50;

// /me/blocked-users（docs/plan/m12-product-growth.md 交付內容 3）：我封鎖的使用者名單＋
// 解除封鎖入口。這支頁面對封鎖發起人自己完全透明（本來就該看得到自己封鎖了誰），無感知
// 封鎖只影響「被封鎖的那一方」。低頻功能，不做分頁 UI，一次抓最多 50 筆。
export default async function BlockedUsersPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const blocks = await db.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
    select: {
      id: true,
      blockedId: true,
      createdAt: true,
      blocked: { select: { profile: { select: { nickname: true } } } },
    },
  });

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <BackBar fallbackHref="/me/settings" />
      <h1 className="text-2xl font-bold tracking-tight">封鎖名單</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        被你封鎖的使用者無法對你的物品留言或收到你的直贈邀請。
      </p>

      {blocks.length === 0 ? (
        <EmptyState icon={ShieldOff} title="目前沒有封鎖任何人" />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {blocks.map((b) => (
            <li key={b.id}>
              <BlockedUserRow
                blockedId={b.blockedId}
                nickname={b.blocked.profile?.nickname ?? "好物共享使用者"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
