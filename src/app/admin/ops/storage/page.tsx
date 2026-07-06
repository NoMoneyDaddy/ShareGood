import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatBytes, formatTaipeiDateTime } from "../format";
import { OpsNav } from "../ops-nav";
import { requireOpsPageAccess } from "../require-ops-access";

export const metadata = { title: "Storage 用量 - 營運儀表板" };

const PAGE_SIZE = 20;

const ITEM_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  pending_review: "待審核",
  published: "上架中",
  reserved: "已預約",
  handover_pending: "交接中",
  completed: "已完成",
  expired: "已到期",
  removed_by_user: "物主自行下架",
  removed_by_moderator: "管理員下架",
};

// `/admin/ops` Storage 分頁（master-plan §8a 交付內容 2＋7）：目前總用量、依物品狀態分類、
// 孤兒用量（帶「待清理」提示，只呈現不自動清除，見規格 scope guard）、歷史趨勢。
export default async function AdminOpsStoragePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  await requireOpsPageAccess();
  const { cursor } = await searchParams;

  const [latest, history] = await Promise.all([
    db.storageUsageSnapshot.findFirst({ orderBy: { snapshotAt: "desc" } }),
    db.storageUsageSnapshot.findMany({
      orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = history.length > PAGE_SIZE;
  const page = hasMore ? history.slice(0, PAGE_SIZE) : history;

  const byItemStatus =
    latest?.byItemStatus &&
    typeof latest.byItemStatus === "object" &&
    !Array.isArray(latest.byItemStatus)
      ? (latest.byItemStatus as Record<string, number>)
      : {};

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Storage 用量</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        MinIO 實際用量、依物品狀態分類、孤兒用量（已下架但圖片未清除）。
      </p>

      <OpsNav active="/admin/ops/storage" />

      {!latest ? (
        <p className="mt-6 rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-soft">
          尚無快照資料，請先觸發 `storage_usage_snapshot` job
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs text-ink-soft">bucket「{latest.bucket}」總用量</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                {formatBytes(latest.totalBytes.toString())}
              </p>
              <p className="text-xs text-ink-soft">{latest.objectCount} 個物件</p>
            </div>
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2">
                <p className="text-xs text-ink-soft">孤兒用量</p>
                <Badge
                  variant="outline"
                  className="border-amber-500/50 text-amber-700 dark:text-amber-400"
                >
                  待清理
                </Badge>
              </div>
              <p className="mt-1 text-lg font-semibold text-ink">
                {formatBytes((latest.orphanedBytes ?? BigInt(0)).toString())}
              </p>
              <p className="text-xs text-ink-soft">
                {latest.orphanedCount ?? 0} 個物件（已下架，圖片未清除）
              </p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs text-ink-soft">最後快照時間</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {formatTaipeiDateTime(latest.snapshotAt)}
              </p>
            </div>
          </div>

          <h2 className="mt-8 text-lg font-semibold text-ink">依物品狀態分類</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
            {Object.keys(byItemStatus).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無資料</p>
            ) : (
              <ul>
                {Object.entries(byItemStatus).map(([status, bytes], index) => (
                  <li
                    key={status}
                    className={cn(
                      "flex items-center justify-between px-4 py-3 text-sm",
                      index > 0 && "border-t border-line",
                    )}
                  >
                    <span className="text-ink">{ITEM_STATUS_LABEL[status] ?? status}</span>
                    <span className="text-ink-soft">{formatBytes(bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink">歷史趨勢</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-card">
        {page.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-soft">尚無快照紀錄</p>
        ) : (
          <ul>
            {page.map((snap, index) => (
              <li
                key={snap.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-3 text-sm",
                  index > 0 && "border-t border-line",
                )}
              >
                <span className="text-ink">
                  {snap.bucket}・{formatBytes(snap.totalBytes.toString())}・{snap.objectCount}{" "}
                  個物件
                  {snap.orphanedBytes
                    ? `（孤兒 ${formatBytes(snap.orphanedBytes.toString())}）`
                    : ""}
                </span>
                <span className="text-xs text-ink-soft">
                  {formatTaipeiDateTime(snap.snapshotAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/ops/storage?cursor=${page[page.length - 1].id}`}
            className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            載入更多
          </Link>
        </div>
      )}
    </main>
  );
}
