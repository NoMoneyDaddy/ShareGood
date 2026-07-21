"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type HandoverSectionProps = {
  itemId: string;
  itemStatus: string;
  isOwner: boolean;
  isReceiver: boolean;
  // handover_pending／completed 狀態才有 handoverId／conversationId 可用（見 page.tsx 查詢）。
  handoverId: string | null;
  conversationId: string | null;
  // completed 狀態才有意義：這個物品是否已經有一則感謝留言（見 page.tsx 查詢）。
  hasThanks: boolean;
  // M12 交付內容 5（面交約定時間，docs/plan/m12-product-growth.md）：只有 handover_pending
  // 狀態才會用到（PATCH /api/handover/[id]/meetup 也只允許 status === "pending" 時修改），
  // 選填＋預設 null 讓「歷程」區塊（completed 狀態）沿用既有呼叫方式不必跟著改。
  scheduledAt?: string | null;
};

// 交接與私訊區塊：只在物品進入 reserved／handover_pending／completed，且目前登入者是
// 物主或被接受者時顯示。跟 Wave 1 的 ClaimsSection／DirectShareSection 一樣獨立成一個
// client component，只在 page.tsx 加一行 import + 一行元件掛載，避免互相 merge 衝突。
export function HandoverSection({
  itemId,
  itemStatus,
  isOwner,
  isReceiver,
  handoverId,
  conversationId,
  hasThanks,
  scheduledAt = null,
}: HandoverSectionProps) {
  if (!isOwner && !isReceiver) return null;
  if (
    itemStatus !== "reserved" &&
    itemStatus !== "handover_pending" &&
    itemStatus !== "completed"
  ) {
    return null;
  }

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight text-ink">交接與私訊</h2>
      {/* 面交安全提示（正式上線衝刺 A1）：只在交接還在進行時顯示，completed 之後沒有意義。
          小字＋icon 的低調樣式，不搶走下方主要操作按鈕的注意力。 */}
      {itemStatus !== "completed" && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-soft">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          面交建議約在人多的公共場所，出發前記得留意自身安全。
        </p>
      )}
      <div className="mt-4">
        {itemStatus === "reserved" && <StartHandoverButton itemId={itemId} />}
        {itemStatus === "handover_pending" &&
          (handoverId && conversationId ? (
            <InProgressHandover
              handoverId={handoverId}
              conversationId={conversationId}
              isOwner={isOwner}
              scheduledAt={scheduledAt}
            />
          ) : (
            // 正常情況下 handover_pending 一定有 handoverId／conversationId（page.tsx 查詢
            // 保證同時存在）；這裡是資料異常時的保底提示，避免整塊區域悄悄消失讓人以為
            // 沒有交接功能。
            <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
              無法顯示交接資訊，請重新整理頁面或稍後再試。
            </p>
          ))}
        {itemStatus === "completed" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">已完成分享</p>
            {isReceiver && !hasThanks && <ThanksForm itemId={itemId} />}
          </div>
        )}
      </div>
    </section>
  );
}

function StartHandoverButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/handover/ensure`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.conversationId) {
        router.push(`/conversations/${data.conversationId}`);
      } else {
        setError(data?.error?.message ?? "無法開始交接，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-soft">物品已經確定要交給對方了，點下方按鈕開始私訊約交接。</p>
      <Button type="button" variant="brand" className="mt-3" disabled={loading} onClick={start}>
        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : "前往交接"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function InProgressHandover({
  handoverId,
  conversationId,
  isOwner,
  scheduledAt,
}: {
  handoverId: string;
  conversationId: string;
  isOwner: boolean;
  scheduledAt: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"complete" | "no-show" | null>(null);
  const [error, setError] = useState("");
  const [confirmingNoShow, setConfirmingNoShow] = useState(false);

  async function markComplete() {
    if (submitting) return;
    setSubmitting("complete");
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/complete`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
    }
  }

  async function markNoShow() {
    if (submitting) return;
    setSubmitting("no-show");
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/no-show`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
      setConfirmingNoShow(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">物品正在交接中，跟對方私訊約時間地點吧。</p>
      {/* M12 交付內容 5（面交約定時間，docs/plan/m12-product-growth.md）：緊鄰上方的面交
          安全提示（A1）放置，任一方可設定/修改/清空，不需要雙方確認。 */}
      <MeetupScheduler handoverId={handoverId} scheduledAt={scheduledAt} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/conversations/${conversationId}`}>前往私訊</Link>
        </Button>
        <Button type="button" variant="brand" disabled={submitting !== null} onClick={markComplete}>
          {submitting === "complete" ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            "標記完成"
          )}
        </Button>
        {isOwner &&
          (confirmingNoShow ? (
            <Button
              type="button"
              variant="destructive"
              disabled={submitting !== null}
              onClick={markNoShow}
            >
              {submitting === "no-show" ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                "確定對方沒有出現？"
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={submitting !== null}
              onClick={() => setConfirmingNoShow(true)}
            >
              對方沒有出現
            </Button>
          ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const MEETUP_DISPLAY_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "medium",
  timeStyle: "short",
});

// datetime-local input 需要「YYYY-MM-DDTHH:mm」這種不含時區資訊的字串。刻意不用
// d.getHours() 等讀取「執行環境本機時區」的寫法：伺服器端渲染（SSR）跑在伺服器的時區，
// 瀏覽器端 hydration 跑在使用者裝置的時區，兩者若不同會讓這個字串在兩端算出不同結果，
// 觸發 React hydration mismatch。改成用固定的台北時區（UTC+8）位移換算，讓 SSR／CSR
// 兩端不論實際跑在哪個時區都算出同一個結果（全站時區約定見 CLAUDE.md 硬規則 8）。
// fromLocalInputValue 是反向換算，兩者必須用同一套時區假設，不能只修一邊。
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const taipei = new Date(d.getTime() + TAIPEI_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${taipei.getUTCFullYear()}-${pad(taipei.getUTCMonth() + 1)}-${pad(taipei.getUTCDate())}T${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
}

// value 是「YYYY-MM-DDTHH:mm」，代表台北時間壁鐘時間；轉回正確的 UTC 時刻。
function fromLocalInputValue(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const utcMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    TAIPEI_OFFSET_MS;
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 面交約定時間小工具（M12 交付內容 5，docs/plan/m12-product-growth.md）：任一方可設定/
// 修改/清空，不需要雙方確認（規格明訂），送出後 router.refresh() 讓 page.tsx 重新查一次
// HandoverRecord.scheduledAt，比照這個檔案其餘操作的既定寫法。
function MeetupScheduler({
  handoverId,
  scheduledAt,
}: {
  handoverId: string;
  scheduledAt: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(scheduledAt === null);
  const [value, setValue] = useState(() => toLocalInputValue(scheduledAt));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function save(next: string | null) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/handover/${handoverId}/meetup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: next }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(data?.error?.message ?? "設定失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || submitting) return;
    // 用 fromLocalInputValue（跟 toLocalInputValue 同一套台北時區假設）取代 new Date(value)
    // ——後者會用瀏覽器本機時區解讀字串，若跟 toLocalInputValue 的時區假設不一致，同一個
    // 顯示值送出後會變成不同的實際時刻。
    const parsed = fromLocalInputValue(value);
    if (!parsed) {
      setError("時間格式不正確");
      return;
    }
    save(parsed.toISOString());
  }

  const displayLabel = scheduledAt ? MEETUP_DISPLAY_FORMATTER.format(new Date(scheduledAt)) : null;

  return (
    <div className="rounded-lg border border-line bg-paper-2 px-3 py-2.5">
      <p className="text-xs font-medium text-ink-soft">約定面交時間</p>
      {!editing ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-sm text-ink">{displayLabel ?? "尚未約定時間"}</p>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            {displayLabel ? "修改" : "設定時間"}
          </Button>
          {displayLabel && (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => save(null)}
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                "清空"
              )}
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            aria-label="約定面交時間"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className="h-11 rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          />
          <Button type="submit" variant="brand" disabled={submitting || !value}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "儲存"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setValue(toLocalInputValue(scheduledAt));
              setEditing(false);
              setError("");
            }}
          >
            取消
          </Button>
        </form>
      )}
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
    </div>
  );
}

// 感謝留言表單：只有接手者、且這個物品還沒有感謝留言時才會被掛載（見上方 HandoverSection）。
// 送出成功後用 router.refresh() 讓 page.tsx 重新查一次 ThanksMessage——ThanksSection 會
// 顯示出新留言，hasThanks 也會跟著變 true 讓這個表單自然消失，不需要另外管理本地已送出狀態。
function ThanksForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = message.trim().length >= 1 && message.trim().length <= 300 && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/thanks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setMessage("");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "留言失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-sm text-ink-soft">跟物主留言感謝一下吧（限一次）。</p>
      <textarea
        aria-label="感謝留言"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="謝謝你的分享！"
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="brand" disabled={!canSubmit}>
        {submitting ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          "送出感謝"
        )}
      </Button>
    </form>
  );
}
