"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LegalDraftNotice } from "@/components/legal-draft-notice";
import { Button } from "@/components/ui/button";

type RatingValue = { stars: number; comment: string | null };

type RatingSectionProps = {
  handoverId: string;
  // 目前登入者是不是這筆交接的物主或接手者（決定要不要顯示表單／自己的提交狀態）。
  isParticipant: boolean;
  // 參與者自己已提交的評分（雙方都評完、進入 revealed 狀態前才有意義）。
  mine: RatingValue | null;
  // 雙方都評完後才非 null：{ owner, receiver } 對所有訪客公開，比照 ThanksMessage 既有先例。
  revealed: { owner: RatingValue; receiver: RatingValue } | null;
};

// M12 交付內容 1（雙向互評，docs/plan/m12-product-growth.md）：只在交接完成後掛載
// （見 page.tsx 呼叫處），比照 thanks-section.tsx／handover-section.tsx 的既有拆分慣例。
//
// 雙盲揭露：雙方都評完之前，評分內容不公開展示；已提交的一方只看得到「我已提交＋等待
// 對方」，看不到對方內容。雙方都評完後，兩則評分才對所有訪客（含非參與者）公開，
// 這時的呈現不再區分「你的／對方的」，改用「物主／接手者」中性標籤。
export function RatingSection({ handoverId, isParticipant, mine, revealed }: RatingSectionProps) {
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stars < 1 || stars > 5 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "評分失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-ink-disabled uppercase tracking-wide">交接評分</h2>

      {revealed ? (
        <div className="mt-3 space-y-3">
          <RatingDisplay label="物主評分" value={revealed.owner} />
          <RatingDisplay label="接手者評分" value={revealed.receiver} />
          {(revealed.owner.comment || revealed.receiver.comment) && <LegalDraftNotice />}
        </div>
      ) : isParticipant ? (
        mine ? (
          <p className="mt-3 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
            你已經評分了，等對方也評分後雙方的評分就會公開顯示在這裡。
          </p>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-2">
            <p className="text-sm text-ink-soft">給這次交接體驗打個分數吧（僅能評一次）。</p>
            {/* 原生 <input type="radio"> 才是 biome a11y/useSemanticElements 認可的星等選擇器
                寫法（比照專案既有 review 教訓：role="radio" 在自訂互動元件上不合規，見
                CLAUDE.md「多選 chip」段的裁定紀錄），視覺上隱藏 input、用 label 包住星星圖示。 */}
            <fieldset className="flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">星等（1–5 星，必填）</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="cursor-pointer rounded-md p-0.5 focus-within:outline-hidden focus-within:ring-3 focus-within:ring-brand/50"
                >
                  <input
                    type="radio"
                    name="rating-stars"
                    value={n}
                    checked={stars === n}
                    onChange={() => setStars(n)}
                    className="sr-only"
                  />
                  <Star
                    size={24}
                    strokeWidth={2}
                    className={stars >= n ? "fill-brand-accent text-brand-accent" : "text-line"}
                    aria-hidden="true"
                  />
                </label>
              ))}
            </fieldset>
            <textarea
              aria-label="評語（選填）"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="想跟對方說的話（選填）"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" variant="brand" disabled={stars < 1 || submitting}>
              {submitting ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                "送出評分"
              )}
            </Button>
          </form>
        )
      ) : null}
    </section>
  );
}

function RatingDisplay({ label, value }: { label: string; value: RatingValue }) {
  return (
    <div className="rounded-lg bg-paper-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        <div className="flex items-center gap-0.5">
          <span className="sr-only">{value.stars} 星</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={14}
              strokeWidth={2}
              className={value.stars >= n ? "fill-brand-accent text-brand-accent" : "text-line"}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      {value.comment && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{value.comment}</p>
      )}
    </div>
  );
}
