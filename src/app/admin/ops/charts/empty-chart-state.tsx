/**
 * 圖表沒有資料時的空狀態（dataviz 技能要求：本機資料少是常態，空狀態要有設計，
 * 不是留白或直接不渲染）。
 */
export function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line text-sm text-ink-soft">
      {message}
    </div>
  );
}
