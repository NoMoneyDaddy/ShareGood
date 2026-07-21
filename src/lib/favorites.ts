import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { LIST_DEFAULT_PAGE_SIZE, LIST_MAX_PAGE_SIZE, type ListedItem } from "@/lib/items";
import { createPreferenceGatedNotification } from "@/lib/notifications";

// M12 產品增量（docs/plan/m12-product-growth.md 交付內容 2）：收藏／我的最愛。

export type ListFavoritesParams = { cursor?: string; limit?: number };

export type FavoritedItem = ListedItem & { favoritedAt: Date };

export type ListFavoritesResult = { items: FavoritedItem[]; nextCursor: string | null };

/**
 * `/me/favorites` 分頁列表。刻意不重用 `src/lib/items.ts` 的 `listPublishedItems`——
 * 收藏不限物品狀態皆可收藏（規格明定「已完成/已下架」也要看得到，只是要顯示對應徽章），
 * `listPublishedItems` 的 `where.status = "published"` 硬性限制不適用這裡；改直接查
 * `ItemFavorite`（以收藏紀錄為查詢根，走 `item_favorites(user_id, created_at)` 索引）
 * 再帶出關聯的 `Item` 欄位，形狀比照 `ListedItem` 額外加一個 `favoritedAt`。
 */
export async function listFavoritedItems(
  userId: string,
  params: ListFavoritesParams,
): Promise<ListFavoritesResult> {
  const take =
    params.limit && params.limit > 0
      ? Math.min(params.limit, LIST_MAX_PAGE_SIZE)
      : LIST_DEFAULT_PAGE_SIZE;

  const favorites = await db.itemFavorite.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          city: { select: { name: true } },
          category: { select: { name: true } },
          images: {
            take: 1,
            orderBy: { sortOrder: "asc" },
            select: { thumbObject: { select: { objectKey: true } } },
          },
        },
      },
    },
  });

  const hasMore = favorites.length > take;
  const page = hasMore ? favorites.slice(0, take) : favorites;

  return {
    items: page.map((f) => ({
      id: f.item.id,
      title: f.item.title,
      status: f.item.status,
      createdAt: f.item.createdAt,
      expiresAt: f.item.expiresAt,
      city: f.item.city.name,
      category: f.item.category.name,
      thumbObjectKey: f.item.images[0]?.thumbObject?.objectKey ?? null,
      favoritedAt: f.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * 物品離開 `published`（被留言認領／直贈接受／抽籤確認）時，對這個物品的收藏者扇出一則
 * `favorite_item_claimed` 提醒（規格「排除物主自己與最終得標者」——他們各自已經有
 * `claim_accepted`／`new_comment` 等既有通知，不必重複收到）。
 *
 * 呼叫端負責在既有的原子 transaction 內呼叫這支函式（`claims`／`direct-shares`／
 * `lottery confirm` 三支既有 accept transaction），讓通知寫入跟物品狀態轉換同一個
 * transaction，不新增任何額外的 DB 往返協調。逐筆呼叫 `createPreferenceGatedNotification`
 * （而非 createMany）：這樣才能各自套用 M4 通知偏好檢查（`inAppEnabled` 為 false 的使用者
 * 完全不寫入）。
 */
export async function notifyFavoritersOfItemClaimed(
  tx: Prisma.TransactionClient,
  params: { itemId: string; itemTitle: string; excludeUserIds: string[] },
): Promise<void> {
  const favoriters = await tx.itemFavorite.findMany({
    where: { itemId: params.itemId, userId: { notIn: params.excludeUserIds } },
    select: { userId: true },
  });

  for (const favoriter of favoriters) {
    await createPreferenceGatedNotification(tx, {
      userId: favoriter.userId,
      eventType: "favorite_item_update",
      type: "completion_confirmed",
      payload: {
        itemId: params.itemId,
        itemTitle: params.itemTitle,
        kind: "favorite_item_claimed",
      },
    });
  }
}

/**
 * `item-expiration` job 的到期前提醒分支（`processReminders`）呼叫：除了既有通知物主之外，
 * 額外對該物品的收藏者也發一則 `favorite_item_expiring`（同一批次查詢，不新增 job；規格
 * 交付內容 2「即將到期提醒」）。排除物主本人，避免物主若剛好也收藏了自己的物品時收到
 * 重複的到期提醒（物主已經有自己專屬的 `item_expiring_reminder` 通知）。
 */
export async function notifyFavoritersOfItemExpiring(
  tx: Prisma.TransactionClient,
  params: { itemId: string; itemTitle: string; ownerId: string },
): Promise<void> {
  const favoriters = await tx.itemFavorite.findMany({
    where: { itemId: params.itemId, userId: { not: params.ownerId } },
    select: { userId: true },
  });

  for (const favoriter of favoriters) {
    await createPreferenceGatedNotification(tx, {
      userId: favoriter.userId,
      eventType: "favorite_item_update",
      type: "completion_confirmed",
      payload: {
        itemId: params.itemId,
        itemTitle: params.itemTitle,
        kind: "favorite_item_expiring",
      },
    });
  }
}
