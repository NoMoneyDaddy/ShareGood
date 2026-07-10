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

// 機關調閱請求建檔表單（master-plan §7a 交付內容 6）：不對外開放，只有站方客服/admin 收到
// 正式公文後在這裡手動建檔。moderator/admin 皆可送出（見 POST /api/admin/legal-requests）。
export function LegalRequestForm() {
  const router = useRouter();
  const [agencyName, setAgencyName] = useState("");
  const [caseReference, setCaseReference] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [requestScope, setRequestScope] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notifyUser, setNotifyUser] = useState(true);
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
      if (!agencyName || !caseReference || !legalBasis || !requestScope || !receivedAt) {
        setError("請填寫完整欄位");
        return;
      }
      if (validTargets.length === 0) {
        setError("請至少指定一個調閱範圍目標");
        return;
      }
      const res = await fetch("/api/admin/legal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyName,
          caseReference,
          legalBasis,
          requestScope,
          receivedAt,
          notifyUser,
          targets: validTargets,
        }),
      });
      if (res.status === 201) {
        router.refresh();
        setAgencyName("");
        setCaseReference("");
        setLegalBasis("");
        setRequestScope("");
        setReceivedAt("");
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          placeholder="機關名稱"
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
        />
        <Input
          placeholder="案號"
          value={caseReference}
          onChange={(e) => setCaseReference(e.target.value)}
        />
        <Input
          type="date"
          placeholder="公文到站日期"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={notifyUser}
            onChange={(e) => setNotifyUser(e.target.checked)}
          />
          通知當事人（預設是，除非公文載明不得通知）
        </label>
      </div>
      <Textarea
        className="mt-2"
        placeholder="法源條文"
        value={legalBasis}
        onChange={(e) => setLegalBasis(e.target.value)}
        rows={2}
      />
      <Textarea
        className="mt-2"
        placeholder="調閱範圍（例如：OO 使用者近 90 天私訊）"
        value={requestScope}
        onChange={(e) => setRequestScope(e.target.value)}
        rows={2}
      />
      <div className="mt-3 flex flex-col gap-2">
        {targets.map((t) => (
          <div key={t.key} className="flex gap-2">
            <Input
              placeholder="目標類型（user／item／conversation／message 擇一）"
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
        建檔
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
