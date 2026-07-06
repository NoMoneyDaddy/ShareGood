"use client";

import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
};

const POLL_INTERVAL_MS = 5000;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

// 對話串：伺服器端已經確認過成員資格並帶入初始訊息，這裡只負責 polling 刷新與送出新訊息。
// M1 範圍簡化：不用 websocket/SSE，每 5 秒重新拉一次最新一頁（預設 20 筆）並整批替換顯示，
// 這對交接這種低頻率的私訊場景已經足夠即時。
export function ConversationThread({
  conversationId,
  currentUserId,
  initialMessages,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        // API 回傳新到舊，顯示時要反轉成舊到新（聊天視覺習慣）。
        setMessages([...data.messages].reverse());
      }
    } catch {
      // polling 失敗就靜靜略過，下一次輪詢再試；不用錯誤訊息打斷閱讀。
    }
  }, [conversationId]);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, []);

  // polling 刷新時，只有使用者本來就停在接近底部才自動捲到最新訊息；如果使用者往上
  // 捲去看舊訊息，polling 不該打斷閱讀、把畫面搶捲回底部。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 特意依賴 messages 觸發重新捲動，effect 內用 DOM API 讀取捲動位置而不是讀 messages 變數本身
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom <= 80) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  const canSend = body.trim().length >= 1 && body.trim().length <= 1000 && !sending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setBody("");
        await refresh();
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      } else {
        setError(data?.error?.message ?? "送出失敗，請再試一次");
      }
    } catch {
      setError("網路連線異常，請再試一次");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-2xl border border-line bg-card">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-ink-soft">還沒有訊息，說聲你好開始交接吧</p>
        )}
        {messages.map((m) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  mine ? "bg-brand text-white" : "bg-paper-2 text-ink",
                )}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <span
                  className={cn("mt-1 block text-[11px]", mine ? "text-white/70" : "text-ink-soft")}
                >
                  {formatTime(m.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
        <label htmlFor="conversation-message" className="sr-only">
          輸入訊息
        </label>
        <input
          id="conversation-message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder="輸入訊息…"
          className="h-10 flex-1 rounded-lg border border-line bg-paper px-3 text-base text-ink outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="送出訊息"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Send size={18} aria-hidden="true" />
          )}
        </button>
      </form>
      {error && <p className="px-3 pb-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
