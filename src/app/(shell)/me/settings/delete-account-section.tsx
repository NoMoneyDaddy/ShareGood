"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CONFIRM_PHRASE = "刪除我的帳號";

type PrivacyRequestInfo = {
  id: string;
  status: string;
  coolingOffUntil: string | null;
} | null;

const TAIPEI_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "long",
  timeStyle: "short",
});

// 帳號刪除區塊（master-plan §7a 交付內容 3）：二次確認（要求輸入固定字串）→ 7 天冷卻期
// →（此區塊之外由排程 job 執行）去識別化。冷卻期內可撤銷。
export function DeleteAccountSection({ latest }: { latest: PrivacyRequestInfo }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const inCoolingOff = latest?.status === "cooling_off";

  async function handleSubmit() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/privacy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "account_deletion", reason }),
      });
      if (res.status === 201) {
        setConfirmOpen(false);
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setMessage(body?.error?.message ?? "申請失敗，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleCancel() {
    if (!latest) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/me/privacy-requests/${latest.id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setMessage("撤銷失敗，請重新整理頁面再試一次。");
      }
    } finally {
      setPending(false);
    }
  }

  if (inCoolingOff && latest) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-ink">
          帳號將於{" "}
          <strong className="font-semibold">
            {latest.coolingOffUntil
              ? TAIPEI_FORMATTER.format(new Date(latest.coolingOffUntil))
              : "—"}
          </strong>{" "}
          完成刪除。冷卻期內可以隨時撤銷。
        </p>
        <Button className="mt-3" variant="outline" disabled={pending} onClick={handleCancel}>
          {pending && <Loader2 className="animate-spin" size={14} aria-hidden="true" />}
          撤銷刪除申請
        </Button>
        {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
      </div>
    );
  }

  if (latest?.status === "rejected") {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-ink">
          你先前的刪除申請因法律程序原因暫無法執行，請透過{" "}
          <a href="/support" className="underline underline-offset-2">
            客服回報
          </a>{" "}
          進一步了解。
        </p>
      </div>
    );
  }

  if (!confirmOpen) {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-ink-soft">
          刪除帳號後，你的姓名、Email、大頭貼等可識別資料會被改寫為無法識別的內容，且無法復原；你
          留下的物品、留言、感謝訊息、貢獻值等紀錄會保留（顯示為「已刪除的使用者」），以維持其他
          使用者看得到的歷史紀錄完整性。送出後有 7 天冷卻期，期間可以撤銷。
        </p>
        <Button className="mt-3" variant="destructive" onClick={() => setConfirmOpen(true)}>
          刪除我的帳號
        </Button>
      </div>
    );
  }

  const canSubmit = confirmText === CONFIRM_PHRASE && !pending;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-ink">
        請輸入「<strong className="font-semibold">{CONFIRM_PHRASE}</strong>」以確認，此動作 7
        天冷卻期滿後即無法復原。
      </p>
      <Input
        className="mt-3"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRM_PHRASE}
        aria-label="輸入確認字串"
      />
      <Textarea
        className="mt-2"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="想告訴我們刪除的原因嗎？（選填）"
        rows={3}
      />
      <div className="mt-3 flex gap-2">
        <Button variant="destructive" disabled={!canSubmit} onClick={handleSubmit}>
          {pending && <Loader2 className="animate-spin" size={14} aria-hidden="true" />}
          確認刪除帳號
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setConfirmOpen(false);
            setConfirmText("");
          }}
        >
          取消
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
    </div>
  );
}
