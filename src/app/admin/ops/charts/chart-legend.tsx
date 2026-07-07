import { cn } from "@/lib/utils";

export interface ChartLegendItem {
  label: string;
  swatchClassName: string;
}

/**
 * 兩個以上系列一律要有 legend（identity 不能只靠顏色比對，dataviz 技能規則）；
 * 單一系列不需要 legend box，呼叫端不要為單系列圖表渲染這個元件。
 */
export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.swatchClassName)}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
