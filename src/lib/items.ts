import type { ItemStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

// GET /api/items 與 /items 瀏覽頁共用的查詢邏輯（master-plan §6 第 2 項「列表」、
// 首頁/瀏覽頁補上真實資料時抽出來的共用函式）。/items 頁是 server component，直接呼叫
// 這支函式查 db，不透過自打 HTTP 呼叫 API route（見 CLAUDE.md 硬規則：安全底線之外，
// server-to-server 自呼叫也會多一趟不必要的網路往返）；API route 本身則維持對外的
// GET /api/items 合約不變，內部改成呼叫這支共用函式，避免兩份重複的查詢邏輯。
//
// 篩選＋排序刻意只用 items(status, city_id, category_id, created_at) 這條複合索引
// 涵蓋的欄位（見 master-plan §11.2），關鍵字用 title/description contains 屬於索引
// 之外的額外過濾，不影響 status+city+category+createdAt 這段走索引。
export const LIST_DEFAULT_PAGE_SIZE = 20;
export const LIST_MAX_PAGE_SIZE = 50;

export type ListItemsParams = {
  cityId?: string;
  categoryId?: string;
  keyword?: string;
  cursor?: string;
  limit?: number;
  sort?: "newest" | "expiring";
};

export type ListedItem = {
  id: string;
  title: string;
  status: ItemStatus;
  createdAt: Date;
  expiresAt: Date | null;
  city: string;
  category: string;
  thumbObjectKey: string | null;
};

export type ListItemsResult = {
  items: ListedItem[];
  nextCursor: string | null;
};

export async function listPublishedItems(params: ListItemsParams): Promise<ListItemsResult> {
  const take =
    params.limit && params.limit > 0
      ? Math.min(params.limit, LIST_MAX_PAGE_SIZE)
      : LIST_DEFAULT_PAGE_SIZE;
  const sort = params.sort === "expiring" ? "expiring" : "newest";
  const keyword = params.keyword?.trim() || undefined;

  const where = {
    status: "published" as const,
    ...(params.cityId ? { cityId: params.cityId } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" as const } },
            { description: { contains: keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // M3（master-plan §8）：sort=expiring 時把有到期日、且快到期的物品排到前面
  // （expiresAt 由小到大，null 排最後），同分再用 createdAt/id 當 tie-breaker
  // 維持 cursor 分頁的穩定排序。走 items(status, expiresAt) 這條既有複合索引。
  const orderBy =
    sort === "expiring"
      ? [
          { expiresAt: { sort: "asc" as const, nulls: "last" as const } },
          { createdAt: "desc" as const },
          { id: "desc" as const },
        ]
      : [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const items = await db.item.findMany({
    where,
    orderBy,
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
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
  });

  const hasMore = items.length > take;
  const page = hasMore ? items.slice(0, take) : items;

  return {
    items: page.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      city: item.city.name,
      category: item.category.name,
      thumbObjectKey: item.images[0]?.thumbObject?.objectKey ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
