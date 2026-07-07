"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_ATTACHMENTS = 3; // 同步 src/app/api/support-tickets/route.ts 的 MAX_ATTACHMENTS

const CATEGORY_OPTIONS: { value: "bug" | "account" | "other"; label: string }[] = [
  { value: "bug", label: "功能異常（bug）" },
  { value: "account", label: "帳號問題" },
  { value: "other", label: "其他" },
];

type AttachmentSlot = {
  key: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  storageObjectId?: string;
  error?: string;
};

// 使用者回報入口（master-plan §7 交付內容 5）：bug／帳號問題／其他，可附最多 3 張截圖。
// 比照 src/app/items/new/item-form.tsx 的圖片上傳模式，但走獨立的
// /api/uploads/support-attachment 端點（單一尺寸，不是物品圖片的 thumb+medium 兩張）。
export function TicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<"bug" | "account" | "other" | "">("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<AttachmentSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function addAttachments(files: FileList | null) {
    if (!files) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files).slice(0, room);

    const newSlots = picked.map((file) => {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.push(previewUrl);
      return { key, previewUrl, file };
    });

    setAttachments((prev) => [
      ...prev,
      ...newSlots.map(({ key, previewUrl }) => ({
        key,
        previewUrl,
        status: "uploading" as const,
      })),
    ]);

    await Promise.all(
      newSlots.map(async ({ key, file }) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/uploads/support-attachment", {
            method: "POST",
            body: form,
          });
          const data = await res.json().catch(() => null);

          setAttachments((prev) =>
            prev.map((att) =>
              att.key !== key
                ? att
                : res.ok && data?.storageObjectId
                  ? { ...att, status: "done", storageObjectId: data.storageObjectId }
                  : { ...att, status: "error", error: data?.error?.message ?? "上傳失敗" },
            ),
          );
        } catch {
          setAttachments((prev) =>
            prev.map((att) =>
              att.key !== key
                ? att
                : { ...att, status: "error", error: "上傳失敗，請檢查網路連線" },
            ),
          );
        }
      }),
    );
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.key === key);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== target.previewUrl);
      }
      return prev.filter((a) => a.key !== key);
    });
  }

  const readyAttachments = attachments.filter(
    (a): a is AttachmentSlot & { storageObjectId: string } =>
      a.status === "done" && !!a.storageObjectId,
  );
  const hasUploading = attachments.some((a) => a.status === "uploading");
  const canSubmit =
    !!category &&
    subject.trim().length >= 2 &&
    description.trim().length >= 1 &&
    !hasUploading &&
    !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject,
          description,
          attachmentObjectIds: readyAttachments.map((a) => a.storageObjectId),
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        router.push(`/support/${data.id}`);
        router.refresh();
      } else {
        setFormError(data?.error?.message ?? "送出失敗，請再試一次");
        setSubmitting(false);
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="category">類型</Label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          required
          className="h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        >
          <option value="">請選擇</option>
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">標題（2–100 字）</Label>
        <input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          minLength={2}
          maxLength={100}
          placeholder="簡短描述你遇到的問題"
          required
          className="h-11 w-full rounded-lg border border-line bg-card px-3 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">詳細說明</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={3000}
          rows={5}
          placeholder="請描述發生的狀況、你做了什麼操作、預期跟實際結果的差異"
          required
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="attachments">
          截圖（選填，{attachments.length}/{MAX_ATTACHMENTS}）
        </Label>
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.key}
              className="relative h-20 w-20 shrink-0 rounded-lg border border-line bg-paper-2"
            >
              {/* 圓角改套在 img 與遮罩上、父容器不用 overflow-hidden：
                  overflow-hidden 會連移除按鈕超出邊界的觸控熱區一起裁掉（含命中測試）。 */}
              {/* biome-ignore lint/performance/noImgElement: 本機選檔的暫時預覽（blob: URL） */}
              <img src={att.previewUrl} alt="" className="h-full w-full rounded-lg object-cover" />
              {att.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink/40">
                  <Loader2 size={20} className="animate-spin text-white" aria-hidden="true" />
                </div>
              )}
              {att.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/80 p-1 text-center text-[10px] text-white">
                  {att.error}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(att.key)}
                aria-label="移除這張截圖"
                className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/60 text-white after:absolute after:-inset-3 after:content-['']"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          {attachments.length < MAX_ATTACHMENTS && (
            <label className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-ink-soft">
              <span className="text-lg leading-none">＋</span>
              新增
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  addAttachments(e.target.files);
                  e.target.value = "";
                }}
                className="sr-only"
              />
            </label>
          )}
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" variant="brand" size="xl" disabled={!canSubmit} className="w-full">
        {submitting ? "送出中…" : "送出回報"}
      </Button>
    </form>
  );
}
