import { Heart } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BackBar } from "@/components/back-bar";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { listFavoritedItems } from "@/lib/favorites";
import { publicUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "我的收藏" };

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿（未上架）",
  pending_review: "審核中",
  published: "分享中",
  reserved: "已配對，等待交接",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已到期下架",
  removed_by_user: "已下架",
  removed_by_moderator: "已下架",
};

// 進行中的狀態用預設（品牌色）突顯，已完成用 outline 弱化，其餘下架/到期用 destructive
// 提醒使用者這個物品可能已經拿不到手了（比照 /me/wallet 的既定用色慣例）。
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  pending_review: "secondary",
  published: "default",
  reserved: "secondary",
  handover_pending: "secondary",
  completed: "outline",
  expired: "destructive",
  removed_by_user: "destructive",
  removed_by_moderator: "destructive",
};

// /me/favorites（docs/plan/m12-product-growth.md 交付內容 2）：收藏清單，不限物品狀態
// （已完成/已下架的收藏也留著讓使用者回顧，用狀態徽章標示目前狀態，不像 /items 瀏覽頁
// 只顯示可互動的 published 物品）。
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");

  const raw = await searchParams;
  const cursor = Array.isArray(raw.cursor) ? raw.cursor[0] : raw.cursor;

  const result = await listFavoritedItems(userId, { cursor });

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
      <BackBar fallbackHref="/me" />
      <h1 className="text-2xl font-bold tracking-tight">我的收藏</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        收藏的物品被別人接走或即將到期時，我們會提醒你。
      </p>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="還沒有收藏任何物品"
          description="逛好物時點一下收藏，之後想找回來就在這裡。"
          action={{ href: "/items", label: "去逛逛好物" }}
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {result.items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/items/${item.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                  {item.thumbObjectKey ? (
                    <Image
                      src={publicUrl(item.thumbObjectKey)}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
                      無圖片
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium text-ink">{item.title}</p>
                    <Badge variant={STATUS_VARIANT[item.status] ?? "outline"} className="shrink-0">
                      {STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {item.city}・{item.category}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.nextCursor && (
        <div className="mt-6 flex justify-center">
          <Link
            href={`/me/favorites?cursor=${result.nextCursor}`}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-2 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            下一頁 →
          </Link>
        </div>
      )}
    </div>
  );
}
