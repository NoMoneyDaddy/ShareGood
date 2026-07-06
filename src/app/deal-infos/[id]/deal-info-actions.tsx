"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DealInfoStatus } from "@/generated/prisma/enums";

// DealInfo 詳情頁的狀態相關操作（master-plan §9a 交付內容 1／2）：
// - pending_review：moderator/admin 可直接在詳情頁核准/駁回（跟 /admin/deal-reviews
//   佇列共用同一支 PATCH API，這裡只是多一個入口，方便審核者點連結進來就能處理）。
// - published：登入使用者（含投稿者本人，規格未禁止）可回報「已失效」。
// - stale：原投稿者本人或 moderator/admin 可重新上架（reactivate）。
export function DealInfoActions({
  dealInfoId,
  status,
  isLoggedIn,
  isSubmitter,
  isModerator,
}: {
  dealInfoId: string;
  status: DealInfoStatus;
  isLoggedIn: boolean;
  isSubmitter: boolean;
  isModerator: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function transition(nextStatus: "published" | "rejected") {
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/deal-infos/${dealInfoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "操作失敗，請再試一次");
        return;
      }
      router.refresh();
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  async function reportStale() {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/deal-infos/${dealInfoId}/stale-reports`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "回報失敗，請再試一次");
        return;
      }
      setMessage(data?.becameStale ? "已回報，這則好康已被標記為可能失效" : "已回報，感謝提供資訊");
      router.refresh();
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setPending(false);
    }
  }

  if (status === "pending_review" && isModerator) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <p className="text-sm font-medium text-ink">這則好康資訊待審核</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => transition("published")}>
            核准
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => transition("rejected")}
          >
            駁回
          </Button>
        </div>
      </div>
    );
  }

  if (status === "published" && isLoggedIn) {
    return (
      <div className="mt-6">
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        {message && <p className="mb-2 text-sm text-ink-soft">{message}</p>}
        <Button size="sm" variant="outline" disabled={pending} onClick={reportStale}>
          回報已失效
        </Button>
      </div>
    );
  }

  if (status === "stale" && (isSubmitter || isModerator)) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <p className="text-sm font-medium text-ink">這則好康已被回報可能失效</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3">
          <Button size="sm" disabled={pending} onClick={() => transition("published")}>
            確認有效，重新上架
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
