import { cn } from "@/lib/utils";
import { formatTaipeiDateTime } from "../format";
import { EmptyChartState } from "./empty-chart-state";

export interface TimelinePoint {
  status: string;
  checkedAt: Date;
  latencyMs: number | null;
}

/**
 * 單一子系統的健康檢查狀態時間線：每次檢查一個等寬色塊，由舊到新排列，色塊之間
 * 2px surface gap（`gap-0.5`，dataviz 技能 marks-and-anatomy 的「surface gap」）。
 * 顏色沿用 `format.ts` 既有的 `STATUS_DOT_CLASS`（跟總覽卡片的狀態燈號同一套顏色，
 * 不另外發明新的圖表色，狀態色本來就該全站統一、不可被當成一般類別色重複使用）。
 * Hover 用原生 `title` 屬性顯示時間＋延遲，零額外相依、零 JS。
 */
export function StatusTimelineRow({
  label,
  points,
  statusLabel,
  statusDotClass,
}: {
  label: string;
  points: TimelinePoint[];
  statusLabel: Record<string, string>;
  statusDotClass: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-ink-soft sm:w-24">{label}</span>
      {points.length === 0 ? (
        <div className="flex-1">
          <EmptyChartState message="近 7 天尚無檢查紀錄" />
        </div>
      ) : (
        <div
          className="flex h-6 flex-1 gap-0.5 overflow-hidden rounded-md"
          role="img"
          aria-label={`${label}近 7 天健康檢查狀態時間線，共 ${points.length} 次檢查`}
        >
          {points.map((point, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 純顯示用的時間序色塊，沒有穩定 id 可用
              key={index}
              className={cn("h-full flex-1", statusDotClass[point.status] ?? "bg-line")}
              title={`${statusLabel[point.status] ?? point.status}・${formatTaipeiDateTime(point.checkedAt)}${
                point.latencyMs != null ? `・${point.latencyMs}ms` : ""
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
