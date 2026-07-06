"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// moderator/admin 認領／放棄這張回報（master-plan §7 交付內容 5「後台處理」：避免多個
// moderator 同時處理同一張 ticket）。PATCH /api/support-tickets/[id] 本身沒有樂觀鎖，
// 因為指派本來就允許被其他 moderator 覆蓋（例如主管把 ticket 轉派給別人），不是搶佔式資源。
export function AssignButton({
  ticketId,
  currentUserId,
  isAssignedToMe,
  hasAssignee,
}: {
  ticketId: string;
  currentUserId: string;
  isAssignedToMe: boolean;
  hasAssignee: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(assigneeId: string | null) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/support-tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "操作失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => submit(isAssignedToMe ? null : currentUserId)}
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : isAssignedToMe ? (
          "放棄認領"
        ) : hasAssignee ? (
          "改指派給我"
        ) : (
          "認領"
        )}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
