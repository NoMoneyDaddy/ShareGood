"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ReportButton } from "@/components/report-button";
import { Button } from "@/components/ui/button";
import { UserBadges } from "@/components/user-badge";

type Claim = {
  id: string;
  userId: string;
  message: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  user: { nickname: string; roles: string[]; contributionPoints: number };
};

const STATUS_LABEL: Record<string, string> = {
  published: "",
  reserved: "這個物品已經有人認領囉",
  handover_pending: "這個物品正在交接中",
  completed: "這個物品已經完成分享",
  expired: "這個物品已經下架",
  removed_by_user: "這個物品已經下架",
  draft: "",
  pending_review: "",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export function ClaimsSection({
  itemId,
  itemStatus,
  currentUserId,
  lotteryActive = false,
}: {
  itemId: string;
  itemStatus: string;
  currentUserId?: string;
  // M5 抽籤（master-plan §5a 交付內容 2）：物品存在非終態抽籤時，
  // POST .../claims 會回 409，這裡提前隱藏留言表單，避免使用者送出後才看到衝突錯誤。
  lotteryActive?: boolean;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [currentStatus, setCurrentStatus] = useState(itemStatus);
  const [claimsError, setClaimsError] = useState("");

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setClaimsError("");
    try {
      const res = await fetch(`/api/items/${itemId}/claims`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setClaims(data.claims);
      } else {
        setClaimsError("留言載入失敗，請重新整理頁面再試一次");
      }
    } catch {
      setClaimsError("網路連線異常，留言載入失敗，請重新整理頁面再試一次");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const canSubmit = message.trim().length >= 1 && message.trim().length <= 500 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch(`/api/items/${itemId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setMessage("");
        // 先到先得模式下，只要留言送出成功（不論這則留言本身是 accepted 還是
        // declined），物品都已經轉成 reserved——declined 代表慢了一步、被別人搶走，
        // 不是「留言失敗」，一樣要把表單收起來，不然使用者會誤以為還能繼續搶。
        setCurrentStatus("reserved");
        await loadClaims();
      } else {
        setFormError(data?.error?.message ?? "留言失敗，請再試一次");
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  const statusNotice = STATUS_LABEL[currentStatus];

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight text-ink">留言</h2>

      {currentStatus === "published" && lotteryActive ? (
        <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
          物品目前為抽籤模式，暫時無法留言，請見下方的抽籤區塊。
        </p>
      ) : currentStatus === "published" ? (
        <form onSubmit={submit} className="mt-4 space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="留言表達你想要這個好物（第一則留言會自動被接受）"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" variant="brand" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                送出中…
              </>
            ) : (
              "送出留言"
            )}
          </Button>
        </form>
      ) : (
        statusNotice && (
          <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
            {statusNotice}
          </p>
        )
      )}

      {claimsError && <p className="mt-4 text-sm text-destructive">{claimsError}</p>}

      <ul className="mt-6 space-y-3">
        {loading && claims.length === 0 && <li className="text-sm text-ink-soft">載入中…</li>}
        {!loading && !claimsError && claims.length === 0 && (
          <li className="text-sm text-ink-soft">還沒有留言，當第一個留言的人吧</li>
        )}
        {claims.map((claim) => (
          <li key={claim.id} className="rounded-xl border border-line bg-card p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="font-medium">{claim.user.nickname}</span>
                <UserBadges roles={claim.user.roles} points={claim.user.contributionPoints} />
              </span>
              <span className="text-xs text-ink-soft">{formatTime(claim.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{claim.message}</p>
            <div className="mt-2 flex items-center gap-3">
              {claim.status === "accepted" && (
                <span className="inline-block rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-ink">
                  已被認領
                </span>
              )}
              {currentUserId && currentUserId !== claim.userId && (
                <ReportButton target={{ claimCommentId: claim.id }} label="檢舉留言" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
