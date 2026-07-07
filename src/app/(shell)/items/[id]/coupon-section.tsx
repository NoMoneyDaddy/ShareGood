"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type CouponInfo = {
  faceValue: string;
  merchantName: string;
  notes: string | null;
  expiresAt: Date | null;
};

type CouponSectionProps = {
  itemId: string;
  // 面額／店家／備註／到期日是描述性文字，任何人都能在物品詳情頁看到（跟券碼明文不同，
  // 這幾個欄位不是機密）。
  coupon: CouponInfo | null;
  // 只有交接進行中／已完成的接手者，且這裡是 true 時，才顯示「查看券碼」按鈕
  // （見 page.tsx：canReveal = isReceiver && status in handover_pending/completed）。
  canReveal: boolean;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
}

// 優惠券資訊區塊：面額／店家／備註／到期日一律顯示；券碼明文只有在接手者按下「查看券碼」
// 時才即時打 /api/items/[id]/coupon/reveal 拿一次，不預先取得、不快取在頁面上。
export function CouponSection({ itemId, coupon, canReveal }: CouponSectionProps) {
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!coupon) return null;

  async function reveal() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/coupon/reveal`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.code === "string") {
        setRevealedCode(data.code);
      } else {
        setError(data?.error?.message ?? "無法查看券碼，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="coupon" className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">優惠券資訊</h2>
      <div className="mt-4 space-y-2 rounded-xl border border-line bg-card p-4 text-sm">
        <p className="text-ink">
          面額：<span className="font-medium">{coupon.faceValue}</span>
        </p>
        <p className="text-ink">
          適用店家：<span className="font-medium">{coupon.merchantName}</span>
        </p>
        {coupon.expiresAt && (
          <p className="text-ink-soft">到期日：{formatDate(coupon.expiresAt)}</p>
        )}
        {coupon.notes && <p className="text-ink-soft">備註：{coupon.notes}</p>}

        {canReveal && (
          <div className="mt-3 border-t border-line pt-3">
            {revealedCode ? (
              <div className="rounded-lg bg-paper-2 px-3 py-2">
                <p className="text-xs text-ink-soft">券碼</p>
                <p className="select-all font-mono text-base font-semibold text-ink">
                  {revealedCode}
                </p>
              </div>
            ) : (
              <Button type="button" variant="brand" disabled={loading} onClick={reveal}>
                {loading ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  "查看券碼"
                )}
              </Button>
            )}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
