export interface LineSeriesInput {
  key: string;
  name: string;
  /** SVG `stroke`/`fill` 用的顏色值，例如 `var(--color-brand)`。 */
  colorVar: string;
  /** 跟 `labels` 對齊的數值陣列。 */
  values: number[];
  formatValue: (value: number) => string;
}

const WIDTH = 600;
const HEIGHT = 160;
const PADDING_LEFT = 4;
const PADDING_RIGHT = 60;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 8;

/**
 * 多系列折線圖（例如 storage 依 bucket 的用量成長）。2px 線寬、≥8px（r=4）端點
 * 圓點、線尾直接標值（`formatValue`），符合 dataviz 技能 marks-and-anatomy 規格。
 * Hover 用 SVG 原生 `<title>`（零額外 JS）；單一系列（本專案目前只有一個
 * bucket）不需要 legend，呼叫端只在 `series.length > 1` 時才渲染 `ChartLegend`。
 */
export function TrendLineChart({
  labels,
  series,
  ariaLabel,
}: {
  labels: string[];
  series: LineSeriesInput[];
  ariaLabel: string;
}) {
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const n = labels.length;
  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);

  const xFor = (i: number) => PADDING_LEFT + (n <= 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth);
  const yFor = (v: number) => PADDING_TOP + plotHeight - (v / max) * plotHeight;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-40 w-full min-w-[420px]"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <line
          x1={PADDING_LEFT}
          y1={PADDING_TOP + plotHeight}
          x2={WIDTH - PADDING_RIGHT}
          y2={PADDING_TOP + plotHeight}
          className="stroke-line"
          strokeWidth={1}
        />
        {series.map((s) => {
          const lastIndex = s.values.length - 1;
          const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={points}
                fill="none"
                style={{ stroke: s.colorVar }}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map((v, i) => (
                <circle
                  // biome-ignore lint/suspicious/noArrayIndexKey: 資料點沒有穩定 id，索引即 x 軸位置
                  key={i}
                  cx={xFor(i)}
                  cy={yFor(v)}
                  r={4}
                  style={{ fill: s.colorVar }}
                  className="stroke-card"
                  strokeWidth={2}
                >
                  <title>{`${s.name}・${labels[i]}・${s.formatValue(v)}`}</title>
                </circle>
              ))}
              {lastIndex >= 0 && (
                <text
                  x={xFor(lastIndex) + 8}
                  y={yFor(s.values[lastIndex])}
                  className="fill-ink text-[10px]"
                  dominantBaseline="middle"
                >
                  {s.formatValue(s.values[lastIndex])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {labels.length > 0 && (
        <div className="mt-1 flex justify-between px-1 text-[11px] text-ink-soft">
          <span>{labels[0]}</span>
          {labels.length > 1 && <span>{labels[labels.length - 1]}</span>}
        </div>
      )}
    </div>
  );
}
