import {
  getConversionRate,
  getMedianCompletionTime,
  getRetentionMetric,
} from "@/lib/growth-metrics";
import { AdminNav } from "../admin-nav";
import { requireGrowthPageAccess } from "./require-growth-access";

export const metadata = { title: "成長指標" };

const CONVERSION_WINDOW_DAYS = 30;

function formatPercent(rate: number | null): string {
  if (rate === null) return "尚無資料";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "尚無資料";
  const hours = seconds / 3600;
  if (hours < 24) return `${hours.toFixed(1)} 小時`;
  return `${(hours / 24).toFixed(1)} 天`;
}

// `/admin/growth`（master-plan §10a／docs/plan/m12-product-growth.md 交付內容 6）：
// 產品成長儀表板，D7/D30 回訪率、上架→成交轉換率、成交中位時間。moderator/admin 限定，
// 純 server component 直接查 db（比照 /admin/ops overview 頁的既定寫法，不透過中介 API
// route），三個指標各自一個卡片區塊。
export default async function AdminGrowthPage() {
  await requireGrowthPageAccess();

  const [d7, d30, conversion, medianCompletion] = await Promise.all([
    getRetentionMetric(7),
    getRetentionMetric(30),
    getConversionRate(CONVERSION_WINDOW_DAYS),
    getMedianCompletionTime(CONVERSION_WINDOW_DAYS),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 pb-24 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">成長指標</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        產品層面的回訪率、轉換率與成交效率，非工程健康指標（那些在營運儀表板）。
      </p>

      <AdminNav current="/admin/growth" />

      <h2 className="mt-8 text-lg font-semibold text-ink">回訪率</h2>
      <p className="mt-1 text-xs text-ink-soft">
        「回訪」定義為註冊後 N 天內，在物品上架／留言／直贈回應／私訊／完成分享接手任一項留下
        紀錄，比純頁面瀏覽更嚴格但更能反映真實參與度。
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {[
          { label: "D7 回訪率", metric: d7 },
          { label: "D30 回訪率", metric: d30 },
        ].map(({ label, metric }) => (
          <div key={label} className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-brand-ink">
              {formatPercent(metric.rate)}
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              cohort {metric.cohortSize} 人・回訪 {metric.retainedCount} 人
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink">
        上架→成交轉換率（近 {CONVERSION_WINDOW_DAYS} 天）
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        分母只計入已到達終態（完成／到期／自行下架／強制下架）的物品，仍在上架中或交接中的
        物品命運未定，不計入分母。
      </p>
      <div className="mt-3 rounded-xl border border-line bg-card p-4">
        <p className="text-3xl font-bold tracking-tight text-brand-ink">
          {formatPercent(conversion.rate)}
        </p>
        <p className="mt-2 text-xs text-ink-soft">
          已到終態 {conversion.terminalCount} 件・成交 {conversion.completedCount} 件
        </p>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink">
        成交中位時間（近 {CONVERSION_WINDOW_DAYS} 天）
      </h2>
      <p className="mt-1 text-xs text-ink-soft">上架到交接完成，中位所需時間。</p>
      <div className="mt-3 rounded-xl border border-line bg-card p-4">
        <p className="text-3xl font-bold tracking-tight text-brand-ink">
          {formatDuration(medianCompletion.medianSeconds)}
        </p>
        <p className="mt-2 text-xs text-ink-soft">樣本數 {medianCompletion.sampleCount} 件</p>
      </div>
    </main>
  );
}
