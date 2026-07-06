import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOpsAccess } from "@/lib/ops-authz";

// GET /api/admin/ops/storage — `/admin/ops` Storage 分頁（master-plan §8a 交付內容 2＋7）：
// 目前總用量、依 bucket／物品狀態分類、孤兒用量、歷史趨勢。moderator/admin 才能存取。
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

// StorageUsageSnapshot 的 totalBytes/orphanedBytes 是 Prisma BigInt 欄位，
// NextResponse.json 底層的 JSON.stringify 遇到 bigint 會直接丟例外，一律轉字串再回傳。
function serializeSnapshot(row: {
  id: string;
  bucket: string;
  totalBytes: bigint;
  objectCount: number;
  orphanedBytes: bigint | null;
  orphanedCount: number | null;
  byItemStatus: unknown;
  snapshotAt: Date;
}) {
  return {
    id: row.id,
    bucket: row.bucket,
    totalBytes: row.totalBytes.toString(),
    objectCount: row.objectCount,
    orphanedBytes: row.orphanedBytes?.toString() ?? null,
    orphanedCount: row.orphanedCount,
    byItemStatus: row.byItemStatus,
    snapshotAt: row.snapshotAt,
  };
}

export async function GET(req: Request) {
  try {
    await requireOpsAccess();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const take =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const bucket = searchParams.get("bucket");

  const latest = await db.storageUsageSnapshot.findFirst({
    where: bucket ? { bucket } : undefined,
    orderBy: { snapshotAt: "desc" },
  });

  const history = await db.storageUsageSnapshot.findMany({
    where: bucket ? { bucket } : undefined,
    orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = history.length > take;
  const page = hasMore ? history.slice(0, take) : history;

  return NextResponse.json({
    latest: latest ? serializeSnapshot(latest) : null,
    history: page.map(serializeSnapshot),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}
