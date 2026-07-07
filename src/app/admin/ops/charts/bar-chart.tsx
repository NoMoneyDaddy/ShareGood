import { cn } from "@/lib/utils";

export interface BarChartDatum {
  key: string;
  label: string;
  value: number;
  /** 完整 hover 說明文字；不提供則預設 `label：value`。 */
  tooltip?: string;
  /** 覆寫這根柱子的顏色（例如耗時分佈的 ordinal 深淺階梯）；不提供則用 `barClassName`。 */
  barClassName?: string;
}

/**
 * 單一系列直條圖（例如「近 7 天慢查詢次數」）。柱體 ≤24px（`max-w-6`）、頂端 4px
 * 圓角、底部方形貼齊基線，符合 dataviz 技能 marks-and-anatomy 規格。單一系列不需要
 * legend（標題已經說明在畫什麼）；只在數值最高的那根柱子上直接標值，其餘靠
 * hover tooltip（純 CSS `group-hover`，零額外 JS／相依）。
 */
export function TrendBarChart({
  data,
  barClassName = "bg-brand",
  ariaLabel,
}: {
  data: BarChartDatum[];
  barClassName?: string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const maxIndex = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);

  return (
    <div className="overflow-x-auto">
      {/* 這裡刻意不用 `items-end`：flex row 預設的 `items-stretch` 會讓每根柱子的
          直接容器（下面的 column div）得到跟 `h-40` 一樣的「確定高度」，柱體本身的
          `height: X%` 才有分母可以算——如果改成 `items-end`，column 會變回
          `height: auto`，子元素的百分比高度永遠算不出來、柱子整根消失（踩過這個
          坑，故意留這段註解）。column 內部用 `justify-end` 把柱體貼齊底部，
          視覺效果跟原本想要的一樣。 */}
      <div
        className="flex h-40 min-w-full gap-1.5 border-b border-line px-1 pt-6"
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          const pct = d.value === 0 ? 0 : Math.max((d.value / max) * 100, 4);
          return (
            <div
              key={d.key}
              className="group relative flex h-full min-w-8 flex-1 flex-col items-center justify-end"
            >
              <span className="pointer-events-none absolute -top-6 z-10 hidden whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium text-paper group-hover:block">
                {d.tooltip ?? `${d.label}：${d.value}`}
              </span>
              {i === maxIndex && d.value > 0 && (
                <span className="mb-1 text-[11px] font-semibold text-ink">{d.value}</span>
              )}
              <div
                className={cn(
                  "w-full max-w-6 rounded-t",
                  d.value === 0 ? "bg-line" : (d.barClassName ?? barClassName),
                )}
                style={{ height: `${d.value === 0 ? 3 : pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex min-w-full gap-1.5 px-1">
        {data.map((d) => (
          <span key={d.key} className="min-w-8 flex-1 text-center text-[11px] text-ink-soft">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface StackedBarSegment {
  name: string;
  value: number;
  className: string;
}

export interface StackedBarDatum {
  key: string;
  label: string;
  segments: StackedBarSegment[];
}

/**
 * 堆疊直條圖（例如「通知重送成功／失敗」）。segment 之間留 2px surface gap
 * （`gap-0.5`），只有最上層 segment 頂端 4px 圓角。2 個以上系列一律要有 legend，
 * 呼叫端記得在圖表下方加 `ChartLegend`。
 */
export function StackedBarChart({
  data,
  ariaLabel,
}: {
  data: StackedBarDatum[];
  ariaLabel: string;
}) {
  const totals = data.map((d) => d.segments.reduce((sum, seg) => sum + seg.value, 0));
  const max = Math.max(1, ...totals);

  return (
    <div className="overflow-x-auto">
      <div
        className="flex h-40 min-w-full items-end gap-1.5 border-b border-line px-1 pt-6"
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          const total = totals[i];
          const columnPct = total === 0 ? 3 : Math.max((total / max) * 100, 4);
          const lastVisibleIndex = d.segments.reduce(
            (last, seg, idx) => (seg.value > 0 ? idx : last),
            -1,
          );
          return (
            <div
              key={d.key}
              className="group relative flex min-w-8 flex-1 flex-col-reverse items-center gap-0.5"
              style={{ height: `${columnPct}%` }}
            >
              <span className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium text-paper group-hover:block">
                {total === 0
                  ? `${d.label}：無紀錄`
                  : `${d.label}：${d.segments.map((s) => `${s.name} ${s.value}`).join("・")}`}
              </span>
              {total === 0 ? (
                <div className="w-full max-w-6 rounded-t bg-line" style={{ height: "100%" }} />
              ) : (
                d.segments.map((seg, si) =>
                  seg.value === 0 ? null : (
                    <div
                      key={seg.name}
                      className={cn(
                        "w-full max-w-6",
                        seg.className,
                        si === lastVisibleIndex && "rounded-t",
                      )}
                      style={{ height: `${(seg.value / total) * 100}%` }}
                    />
                  ),
                )
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex min-w-full gap-1.5 px-1">
        {data.map((d) => (
          <span key={d.key} className="min-w-8 flex-1 text-center text-[11px] text-ink-soft">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
