import { AlertTriangle } from "lucide-react";

// /terms、/privacy 共用的法律文件起草警語。master-plan.md §12 上線前檢查表要求這兩頁
// 「內容先由模型起草、使用者過目；正式營運前建議台灣律師審閱」，且這個警語必須出現在
// 頁面明顯位置——抽成共用元件避免兩頁措辭日後各自漂移。
export function LegalDraftNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3.5 text-sm text-brand-ink">
      <AlertTriangle size={18} strokeWidth={2.2} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="leading-relaxed">
        <strong className="font-bold">重要提醒：</strong>
        本頁內容由 AI 協助起草，尚未經過法律專業審閱，正式營運前應由台灣律師審閱後才能作為正式生效的
        法律文件；目前僅供內部測試與早期使用者參考。
      </p>
    </div>
  );
}
