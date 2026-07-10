"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RETENTION_ACTION_LABEL } from "@/lib/retention-labels";
import { cn } from "@/lib/utils";

type Policy = {
  id: string;
  policyKey: string;
  description: string;
  retentionDays: number | null;
  action: string | null;
  isActive: boolean;
};

const ACTIONS = ["purge", "anonymize", "downgrade", "archive"] as const;

// 單一政策的編輯列（master-plan §7a 交付內容 4／7 /admin/data）：只有 admin 能修改。
// retentionDays 與 action 必須同時為 null 或同時有值（schema 不變式），這裡用同一個
// 「不清理」勾選框連動兩個欄位，避免使用者填出不合法的組合。
export function RetentionPolicyRow({ policy }: { policy: Policy }) {
  const router = useRouter();
  const [neverPurge, setNeverPurge] = useState(policy.retentionDays === null);
  const [retentionDays, setRetentionDays] = useState(policy.retentionDays ?? 90);
  const [action, setAction] = useState(policy.action ?? "purge");
  const [isActive, setIsActive] = useState(policy.isActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/data-retention-policies/${policy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retentionDays: neverPurge ? null : retentionDays,
          action: neverPurge ? null : action,
          isActive,
        }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "更新失敗");
      }
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  return (
    <tr className={cn("border-b border-line", !isActive && "opacity-50")}>
      <td className="py-2 pr-3 align-top">
        <p className="font-medium text-ink">{policy.policyKey}</p>
        <p className="text-xs text-ink-soft">{policy.description}</p>
      </td>
      <td className="py-2 pr-3 align-top">
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={neverPurge}
            onChange={(e) => setNeverPurge(e.target.checked)}
          />
          不自動清理
        </label>
        {!neverPurge && (
          <Input
            className="mt-1.5 w-24"
            type="number"
            min={0}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
        )}
      </td>
      <td className="py-2 pr-3 align-top">
        {!neverPurge && (
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {RETENTION_ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-2 pr-3 align-top">
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          啟用
        </label>
      </td>
      <td className="py-2 align-top">
        <Button size="sm" variant="outline" disabled={pending} onClick={handleSave}>
          儲存
        </Button>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}
