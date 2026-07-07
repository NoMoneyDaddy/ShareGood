"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LotteryStatus =
  | "open"
  | "drawing"
  | "awaiting_confirmation"
  | "completed"
  | "failed_no_entries"
  | "cancelled";

type MyResult = {
  rank: number;
  status: "pending" | "offered" | "confirmed" | "expired" | "declined";
  confirmDeadline: string | null;
  respondedAt: string | null;
};

type LotteryState =
  | { exists: false }
  | {
      exists: true;
      id: string;
      status: LotteryStatus;
      entryDeadline: string;
      entryCount: number;
      myEntryStatus: "entered" | "cancelled" | null;
      myResult: MyResult | null;
    };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

// 抽籤區塊（master-plan §5a 交付內容 9）：比照 thanks-section.tsx／handover-section.tsx 的既有
// 拆分慣例，獨立成一個 client component。抽籤全程不改變 items.status（只有最終確認那一刻才轉
// reserved），因此這裡完全靠自己的 GET /api/items/[id]/lottery 判斷目前進度，不依賴 itemStatus
// （itemStatus 只用來判斷「還沒開過抽籤時，物主能不能看到開抽籤表單」）。
export function LotterySection({
  itemId,
  itemStatus,
  isOwner,
  isLoggedIn,
}: {
  itemId: string;
  itemStatus: string;
  isOwner: boolean;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<LotteryState | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${itemId}/lottery`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) setState(data);
    } catch {
      // 靜默失敗：抽籤區塊載入失敗不影響頁面其他區塊，使用者重新整理即可。
    }
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    load();
    router.refresh();
  }

  if (state === undefined) return null;

  if (!state.exists) {
    if (isOwner && itemStatus === "published") {
      return <CreateLotteryForm itemId={itemId} onCreated={refresh} />;
    }
    return null;
  }

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight text-ink">抽籤</h2>

      {state.status === "open" && (
        <OpenLottery
          itemId={itemId}
          lotteryId={state.id}
          entryDeadline={state.entryDeadline}
          entryCount={state.entryCount}
          isOwner={isOwner}
          isLoggedIn={isLoggedIn}
          myEntryStatus={state.myEntryStatus}
          onChanged={refresh}
        />
      )}

      {state.status === "drawing" && (
        <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
          系統正在開獎，請稍候片刻後重新整理頁面。
        </p>
      )}

      {state.status === "awaiting_confirmation" && (
        <AwaitingConfirmation
          lotteryId={state.id}
          isOwner={isOwner}
          myResult={state.myResult}
          onChanged={refresh}
        />
      )}

      {state.status === "completed" && (
        <p className="mt-4 rounded-lg bg-brand/10 px-3 py-2 text-sm text-ink">
          抽籤已完成，得主已確認，物品已進入交接流程。
        </p>
      )}

      {state.status === "failed_no_entries" && (
        <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
          這場抽籤流標了（截止時無人報名，或所有候補都逾時／婉拒），物品已恢復開放，
          歡迎透過留言或直接贈與的方式分享。
        </p>
      )}

      {state.status === "cancelled" && (
        <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
          物主已取消這場抽籤，這個物品不會再開放抽籤，歡迎透過留言或直接贈與的方式分享。
        </p>
      )}
    </section>
  );
}

function CreateLotteryForm({ itemId, onCreated }: { itemId: string; onCreated: () => void }) {
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!deadline || submitting) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // datetime-local 沒有時區資訊；全站以台北時間為準（master-plan §3.4），這裡明確補上 +08:00。
      // datetime-local 預設值長度是 16（YYYY-MM-DDTHH:mm，無秒），但部分瀏覽器在 step 屬性
      // 允許秒數精度時可能給出長度 19（含秒）的值，固定補 `:00` 會組出格式錯誤的字串，
      // 因此依長度判斷是否需要補秒數，避免 new Date(...) 產生 Invalid Date。
      const withSeconds = deadline.length === 16 ? `${deadline}:00` : deadline;
      const entryDeadline = new Date(`${withSeconds}+08:00`).toISOString();
      const res = await fetch(`/api/items/${itemId}/lottery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryDeadline }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onCreated();
      } else {
        setError(data?.error?.message ?? "建立抽籤失敗，請再試一次");
        setConfirming(false);
      }
    } catch {
      setError("網路連線異常，請再試一次");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold tracking-tight text-ink">開一場抽籤</h2>
      <p className="mt-1 text-sm text-ink-soft">
        設定報名截止時間，截止後系統會公平抽出 1 位得主；
        <span className="font-medium text-ink">報名截止時間建立後不能修改，設錯只能整個取消</span>
        （取消後這個物品會永久失去抽籤資格，只能改用留言或直贈分享），請確認清楚再送出。
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="lottery-deadline" className="sr-only">
            報名截止時間
          </Label>
          <Input
            id="lottery-deadline"
            type="datetime-local"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setConfirming(false);
            }}
            required
          />
        </div>
        <Button type="submit" variant="brand" disabled={submitting || !deadline}>
          {submitting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : confirming ? (
            "確定要開抽籤嗎？再按一次送出"
          ) : (
            "開抽籤"
          )}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}

function OpenLottery({
  itemId,
  lotteryId,
  entryDeadline,
  entryCount,
  isOwner,
  isLoggedIn,
  myEntryStatus,
  onChanged,
}: {
  itemId: string;
  lotteryId: string;
  entryDeadline: string;
  entryCount: number;
  isOwner: boolean;
  isLoggedIn: boolean;
  myEntryStatus: "entered" | "cancelled" | null;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function enter() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/lottery/entries`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onChanged();
      } else {
        setError(data?.error?.message ?? "報名失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelEntry() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/items/${itemId}/lottery/entries`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onChanged();
      } else {
        setError(data?.error?.message ?? "取消報名失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelLottery() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/lotteries/${lotteryId}/cancel`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onChanged();
      } else {
        setError(data?.error?.message ?? "取消抽籤失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-card p-4">
      <p className="text-sm text-ink">
        報名中，目前共 <span className="font-semibold">{entryCount}</span> 人報名。
      </p>
      <p className="mt-1 text-sm text-ink-soft">截止時間：{formatDateTime(entryDeadline)}</p>

      {isOwner ? (
        <>
          <p className="mt-3 text-sm text-ink-soft">
            抽籤進行中，這個物品暫時無法留言或直贈，直到抽籤結束。
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={submitting}
            onClick={cancelLottery}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "取消這場抽籤"
            )}
          </Button>
          <p className="mt-1 text-xs text-ink-soft">
            取消後這個物品會永久失去抽籤資格，請謹慎操作。
          </p>
        </>
      ) : !isLoggedIn ? (
        <p className="mt-3 text-sm text-ink-soft">登入後即可報名參加這場抽籤。</p>
      ) : myEntryStatus === "entered" ? (
        <div className="mt-3">
          <p className="text-sm text-brand">你已經報名這場抽籤了。</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={submitting}
            onClick={cancelEntry}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "取消報名"
            )}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="brand"
          className="mt-3"
          disabled={submitting}
          onClick={enter}
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            "報名參加抽籤"
          )}
        </Button>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function AwaitingConfirmation({
  lotteryId,
  isOwner,
  myResult,
  onChanged,
}: {
  lotteryId: string;
  isOwner: boolean;
  myResult: MyResult | null;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState("");

  async function respond(action: "confirm" | "decline") {
    if (submitting) return;
    setSubmitting(action);
    setError("");
    try {
      const res = await fetch(`/api/lotteries/${lotteryId}/${action}`, { method: "PATCH" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        onChanged();
      } else {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSubmitting(null);
    }
  }

  if (isOwner) {
    return (
      <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
        已完成開獎，正在等待候選人確認中，逾時或婉拒會自動遞補下一位。
      </p>
    );
  }

  if (myResult?.status === "offered" && myResult.confirmDeadline) {
    return (
      <div className="mt-4 rounded-xl border border-brand/40 bg-brand/10 p-4">
        <h3 className="text-sm font-semibold text-ink">恭喜，你中籤了！</h3>
        <p className="mt-1 text-sm text-ink-soft">
          請於 {formatDateTime(myResult.confirmDeadline)} 前確認，逾時視同放棄，將自動遞補下一位。
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="brand"
            disabled={submitting !== null}
            onClick={() => respond("confirm")}
          >
            {submitting === "confirm" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "確認接受"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => respond("decline")}
          >
            {submitting === "decline" ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              "婉拒"
            )}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (myResult?.status === "pending") {
    return (
      <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
        你目前是候補名單中的一員，請耐心等候，如果輪到你會收到站內通知。
      </p>
    );
  }

  if (myResult?.status === "expired" || myResult?.status === "declined") {
    return (
      <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
        很可惜，這次沒有輪到你確認。
      </p>
    );
  }

  return (
    <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-soft">
      報名已經截止，目前正在確認得主中。
    </p>
  );
}
