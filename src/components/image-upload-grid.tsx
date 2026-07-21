"use client";

import { Loader2, X } from "lucide-react";
import type { ImageSlot } from "@/hooks/use-image-upload-slots";

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：把 item-form.tsx 原本內嵌的
// 圖片縮圖格＋新增按鈕 markup 抽成共用元件，搭配 useImageUploadSlots hook 一起在
// /items/new（單筆）與 /items/new/batch（批量，每一列各自一份實例）重用。
// 樣式與互動逐一對齊原本 item-form.tsx 內嵌版本，不改變既有單筆上架表單的視覺與行為。
export function ImageUploadGrid({
  images,
  maxImages,
  onAdd,
  onRemove,
  inputId,
}: {
  images: ImageSlot[];
  maxImages: number;
  onAdd: (files: FileList | null) => void;
  onRemove: (key: string) => void;
  /** file input 的 id，多個 grid 同時出現在同一頁（批量表單每一列）時務必給不同 id。 */
  inputId: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img) => (
        <div
          key={img.key}
          className="relative h-20 w-20 shrink-0 rounded-lg border border-line bg-paper-2"
        >
          {/* 圓角改套在 img 與遮罩上、父容器不用 overflow-hidden：
              overflow-hidden 會把刻意突出邊角的移除按鈕與其觸控熱區一起裁掉（含命中測試）。 */}
          {/* biome-ignore lint/performance/noImgElement: 本機選檔的暫時預覽（blob: URL），不是可最佳化的遠端圖片 */}
          <img src={img.previewUrl} alt="" className="h-full w-full rounded-lg object-cover" />
          {img.status === "uploading" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink/40">
              <Loader2 size={20} className="animate-spin text-white" aria-hidden="true" />
            </div>
          )}
          {img.status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/80 p-1 text-center text-[10px] text-white">
              {img.error}
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(img.key)}
            aria-label="移除這張圖片"
            className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-white ring-2 ring-paper after:absolute after:-inset-2 after:content-['']"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      {images.length < maxImages && (
        <label
          htmlFor={inputId}
          className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-ink-soft"
        >
          <span className="text-lg leading-none">＋</span>
          新增
          <input
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              onAdd(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      )}
    </div>
  );
}
