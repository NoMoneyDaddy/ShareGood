"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 解除保全按鈕（master-plan §7a 交付內容 5）：只有 admin 看得到這頁，直接呼叫 release。
export function ReleaseButton({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRelease() {
    if (!confirm("確定要解除這筆保全嗎？解除後受保護的資料會回到一般清理流程。")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/legal-holds/${holdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={handleRelease}>
      解除保全
    </Button>
  );
}
