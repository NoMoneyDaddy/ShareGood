"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TargetRow = { key: string; targetType: string; targetId: string };

function newRow(): TargetRow {
  return { key: crypto.randomUUID(), targetType: "", targetId: "" };
}

// 建立訴訟保全表單（master-plan §7a 交付內容 5）：只有 admin 看得到這頁（頁面層已擋非
// admin），這裡只負責組請求。target_type 建議值列在 placeholder 裡，不強制下拉選單，
// 因為未來可能擴充涵蓋更多資料類型（見規格 legal_hold_targets 註解）。
export function LegalHoldForm() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [targets, setTargets] = useState<TargetRow[]>([newRow(), newRow()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateTarget(key: string, field: keyof TargetRow, value: string) {
    setTargets((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  async function handleSubmit() {
    setPending(true);
    setError(null);
    try {
      const validTargets = targets.filter((t) => t.targetType.trim() && t.targetId.trim());
      if (!reason.trim() || validTargets.length === 0) {
        setError("請填寫原因，並至少指定一個保全目標");
        return;
      }
      const res = await fetch("/api/admin/legal-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, targets: validTargets }),
      });
      if (res.status === 201) {
        setReason("");
        setTargets([newRow(), newRow()]);
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "建立失敗");
      }
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <Textarea
        placeholder="保全原因（例如：詐騙案調查中，案號 ...）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
      />
      <div className="mt-3 flex flex-col gap-2">
        {targets.map((t) => (
          <div key={t.key} className="flex gap-2">
            <Input
              placeholder="目標類型（user／item／conversation／message／⋯）"
              value={t.targetType}
              onChange={(e) => updateTarget(t.key, "targetType", e.target.value)}
            />
            <Input
              placeholder="目標項目 ID"
              value={t.targetId}
              onChange={(e) => updateTarget(t.key, "targetId", e.target.value)}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setTargets((rows) => [...rows, newRow()])}
        >
          新增目標
        </Button>
      </div>
      <Button className="mt-3" disabled={pending} onClick={handleSubmit}>
        建立保全
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
