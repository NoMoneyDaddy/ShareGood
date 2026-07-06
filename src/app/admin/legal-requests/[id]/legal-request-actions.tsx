"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 審核與匯出動作（master-plan §7a 交付內容 6）：approve/reject 只有 admin 能呼叫，且伺服器
// 端會擋「建檔人不能核准/駁回自己建立的請求」；這裡的 canAct 只是 UX 層面先隱藏按鈕，真正的
// 授權判斷全部在 API。
export function LegalRequestActions({
  requestId,
  status,
  canAct,
}: {
  requestId: string;
  status: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/legal-requests/${requestId}/approve`, {
        method: "PATCH",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "核准失敗");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleReject() {
    const rejectionReason = prompt("請輸入駁回原因：");
    if (!rejectionReason) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/legal-requests/${requestId}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "駁回失敗");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleGenerateExport() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/legal-requests/${requestId}/exports`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "產生匯出包失敗");
      }
    } finally {
      setPending(false);
    }
  }

  if (!canAct) return error ? <p className="text-sm text-destructive">{error}</p> : null;

  return (
    <div className="flex flex-wrap gap-2">
      {(status === "submitted" || status === "legal_review") && (
        <>
          <Button size="sm" disabled={pending} onClick={handleApprove}>
            核准
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={handleReject}>
            駁回
          </Button>
        </>
      )}
      {status === "approved" && (
        <Button size="sm" disabled={pending} onClick={handleGenerateExport}>
          產生匯出包
        </Button>
      )}
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ExportDownloadButton({
  requestId,
  exportId,
}: {
  requestId: string;
  exportId: string;
}) {
  const [pending, setPending] = useState(false);

  async function handleDownload() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/legal-requests/${requestId}/exports/${exportId}/download`,
      );
      if (res.ok) {
        const body = (await res.json()) as { url: string };
        window.location.assign(body.url);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={handleDownload}>
      下載
    </Button>
  );
}
