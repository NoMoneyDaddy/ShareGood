"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// 啟用/停用瀏覽器推播通知（master-plan §6a 交付內容 9、10）。
//
// 前端註冊流程（查證來源：MDN Service Worker API / Push API、web-push npm 套件官方
// README）：
// navigator.serviceWorker.register('/sw.js') → 使用者同意瀏覽器通知權限提示 →
// registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:
// <WEB_PUSH_VAPID_PUBLIC_KEY 轉成的 Uint8Array>}) → 拿到的 PushSubscription 呼叫
// POST /api/web-push/subscriptions。
//
// applicationServerKey 轉 Uint8Array：Push API 規範允許 BufferSource 或 DOMString，但
// 部分瀏覽器（例如較舊版 Firefox）只接受 Uint8Array，這裡採用業界慣用的
// urlBase64ToUint8Array 寫法（Google web.dev push notification 教學同樣寫法）確保
// 跨瀏覽器相容。
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type Status = "checking" | "unsupported" | "unsubscribed" | "subscribed" | "error";

export function WebPushToggle({ publicKey }: { publicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        setStatus("unsupported");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setStatus(existing ? "subscribed" : "unsubscribed");
      } catch {
        setStatus("unsubscribed");
      }
    }
    check();
  }, []);

  async function handleSubscribe() {
    if (!publicKey) {
      setMessage("系統尚未完成推播設定，暫時無法啟用瀏覽器推播");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("需要允許瀏覽器通知權限才能啟用");
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = subscription.toJSON();
      const res = await fetch("/api/web-push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) {
        // 後端沒登記成功，把瀏覽器端剛建立的 PushSubscription 也一併取消，避免瀏覽器端
        // 誤以為已訂閱、但伺服器端其實完全沒有這筆紀錄（永遠收不到推播，使用者卻看不出問題）。
        await subscription.unsubscribe();
        setMessage("啟用失敗，請稍後再試");
        return;
      }
      setStatus("subscribed");
    } catch {
      setMessage("啟用失敗，請確認瀏覽器權限設定");
      setStatus("error");
    } finally {
      setPending(false);
    }
  }

  async function handleUnsubscribe() {
    setPending(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/web-push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setStatus("unsubscribed");
    } catch {
      setMessage("停用失敗，請稍後再試");
    } finally {
      setPending(false);
    }
  }

  if (status === "unsupported") {
    return (
      <div className="rounded-xl border border-line bg-card p-4 text-sm text-ink-soft">
        這個瀏覽器不支援 Web Push 推播通知。
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-4">
      <div>
        <p className="text-sm font-semibold text-ink">瀏覽器推播通知</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {status === "subscribed" ? "已啟用，這台裝置會收到即時推播" : "尚未啟用"}
        </p>
        {message && <p className="mt-1 text-xs text-destructive">{message}</p>}
      </div>
      {status === "subscribed" ? (
        <Button variant="outline" size="sm" onClick={handleUnsubscribe} disabled={pending}>
          停用
        </Button>
      ) : (
        <Button
          variant="brand"
          size="sm"
          onClick={handleSubscribe}
          disabled={pending || status === "checking"}
        >
          啟用
        </Button>
      )}
    </div>
  );
}
