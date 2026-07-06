"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// 上傳公文掃描檔（master-plan §7a 交付內容 6）。
export function DocumentUpload({ requestId }: { requestId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/legal-requests/${requestId}/documents`, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "上傳失敗");
      }
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="text-sm" />
      <Button size="sm" variant="outline" disabled={pending} onClick={handleUpload}>
        上傳公文掃描檔
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
