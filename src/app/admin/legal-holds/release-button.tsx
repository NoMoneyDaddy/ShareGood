"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 解除保全按鈕（master-plan §7a 交付內容 5）：只有 admin 看得到這頁，直接呼叫 release。
export function ReleaseButton({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    if (!confirm("確定要解除這筆保全嗎？解除後受保護的資料會回到一般清理流程。")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/legal-holds/${holdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "解除失敗，請稍後再試");
      }
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={handleRelease}>
        解除保全
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
