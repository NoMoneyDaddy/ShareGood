"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type CouponUsageSectionProps = {
  itemId: string;
  // 聚合統計：任何人都能看到，跟感謝留言一樣是公開資訊，只是不揭露個別回報者身分。
  usableCount: number;
  expiredCount: number;
  // 只有交接確定（handover_pending／completed）且是接手者本人時才顯示回報表單；
  // canReport 由 page.tsx 算好傳入（判斷邏輯跟 CouponSection.canReveal 一致）。
  canReport: boolean;
  // 這個接手者是否已經回報過（unique(item_id, reporter_id) 擋重複，回報過就不再顯示表單）。
  alreadyReported: boolean;
};

// 優惠券使用結果回報區塊（master-plan §9a 交付內容 3）：接手者回報「可用／已失效」，
// 詳情頁顯示聚合統計。**文案刻意不寫「保證有效」「保證可兌換」**——這裡的統計只是
// 使用者回報的事實累積，平台不對券碼本身的有效性背書。
export function CouponUsageSection({
  itemId,
  usableCount,
  expiredCount,
  canReport,
  alreadyReported,
}: CouponUsageSectionProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(alreadyReported);
  const [localUsable, setLocalUsable] = useState(usableCount);
  const [localExpired, setLocalExpired] = useState(expiredCount);

  async function submit(result: "usable" | "expired_or_used") {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/coupon-usage-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setSubmitted(true);
        if (result === "usable") setLocalUsable((n) => n + 1);
        else setLocalExpired((n) => n + 1);
      } else {
        setError(data?.error?.message ?? "回報失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  if (usableCount === 0 && expiredCount === 0 && !canReport) return null;

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">使用結果回報</h2>
      <p className="mt-1.5 text-xs text-ink-soft">
        以下統計為接手者自行回報，僅供參考，平台不保證券碼實際可兌換。
      </p>
      <div className="mt-4 flex gap-4 text-sm text-ink">
        <span>可用：{localUsable} 人回報</span>
        <span>已失效：{localExpired} 人回報</span>
      </div>

      {canReport && (
        <div className="mt-3 border-t border-line pt-3">
          {submitted ? (
            <p className="text-sm text-ink-soft">感謝回報，已收到您的使用結果。</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-soft">這張券實際使用起來如何？</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="brand"
                  size="sm"
                  disabled={submitting}
                  onClick={() => submit("usable")}
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    "可用"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => submit("expired_or_used")}
                >
                  已失效
                </Button>
              </div>
              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
