"use client";

import { useEffect, useRef, useState } from "react";

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：把 item-form.tsx 原本內嵌的
// 圖片上傳邏輯（addImages／ImageSlot 狀態機）抽成共用 hook，讓 /items/new（單筆）與
// /items/new/batch（批量，每一列各自一份實例）共用，不要複製貼上整段上傳邏輯。行為與原本
// item-form.tsx 內嵌版本逐一對齊，不改變既有單筆上架表單的使用者體驗。

export type ImageSlot = {
  key: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  thumbObjectId?: string;
  mediumObjectId?: string;
  error?: string;
};

export function useImageUploadSlots(maxImages: number) {
  const [images, setImages] = useState<ImageSlot[]>([]);

  // 追蹤本機選檔建立的 blob: 預覽連結，組件卸載時統一釋放，避免瀏覽器記憶體洩漏。
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function addImages(files: FileList | null) {
    if (!files) return;
    const room = maxImages - images.length;
    const picked = Array.from(files).slice(0, room);

    const newSlots = picked.map((file) => {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.push(previewUrl);
      return { key, previewUrl, file };
    });

    setImages((prev) => [
      ...prev,
      ...newSlots.map(({ key, previewUrl }) => ({ key, previewUrl, status: "uploading" as const })),
    ]);

    await Promise.all(
      newSlots.map(async ({ key, file }) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/uploads", { method: "POST", body: form });
          const data = await res.json().catch(() => null);
          const thumbId = data?.variants?.thumb?.storageObjectId;
          const mediumId = data?.variants?.medium?.storageObjectId;

          setImages((prev) =>
            prev.map((img) =>
              img.key !== key
                ? img
                : res.ok && thumbId && mediumId
                  ? { ...img, status: "done", thumbObjectId: thumbId, mediumObjectId: mediumId }
                  : { ...img, status: "error", error: data?.error?.message ?? "上傳失敗" },
            ),
          );
        } catch {
          setImages((prev) =>
            prev.map((img) =>
              img.key !== key
                ? img
                : { ...img, status: "error", error: "上傳失敗，請檢查網路連線" },
            ),
          );
        }
      }),
    );
  }

  function removeImage(key: string) {
    setImages((prev) => {
      const target = prev.find((img) => img.key === key);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== target.previewUrl);
      }
      return prev.filter((img) => img.key !== key);
    });
  }

  const readyImages = images.filter(
    (img): img is ImageSlot & { thumbObjectId: string; mediumObjectId: string } =>
      img.status === "done" && !!img.thumbObjectId && !!img.mediumObjectId,
  );
  const hasUploading = images.some((img) => img.status === "uploading");

  return { images, addImages, removeImage, readyImages, hasUploading };
}
