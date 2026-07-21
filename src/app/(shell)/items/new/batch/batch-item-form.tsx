"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageUploadGrid } from "@/components/image-upload-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImageUploadSlots } from "@/hooks/use-image-upload-slots";
import {
  COUPON_CATEGORY_SLUG,
  EXPIRING_FOOD_CATEGORY_SLUG,
  POINT_CATEGORY_SLUG,
  TICKET_CATEGORY_SLUG,
} from "@/lib/categories";

const MAX_ROWS = 10;
const MIN_ROWS = 1;
const DEFAULT_ROWS = 2;
const MAX_IMAGES_PER_ROW = 5;

const SPECIAL_CATEGORY_SLUGS = new Set([
  COUPON_CATEGORY_SLUG,
  EXPIRING_FOOD_CATEGORY_SLUG,
  TICKET_CATEGORY_SLUG,
  POINT_CATEGORY_SLUG,
]);

let rowIdCounter = 0;
function nextRowId() {
  rowIdCounter += 1;
  return `row-${rowIdCounter}`;
}

type RowPayload = {
  title: string;
  description: string;
  images: Array<{ thumbObjectId: string; mediumObjectId: string }>;
};
type RowRegistryEntry = { isReady: () => boolean; getPayload: () => RowPayload };

// M12 交付內容 7（批量上架，docs/plan/m12-product-growth.md）：`/items/new` 的「一次建立
// 多筆相似物品」捷徑。scope guard：僅適用一般物品分類，選到優惠券／即期食品／電子票券／
// 點數好康會被擋下（這幾種分類有各自的子表單與法規欄位，天生就不容易「相似批量」）。
//
// 每一列各自用一份 useImageUploadSlots + ImageUploadGrid 實例（見 src/hooks/
// use-image-upload-slots.ts、src/components/image-upload-grid.tsx），跟單筆表單
// item-form.tsx 共用同一套邏輯，不複製貼上。各列（BatchRow）是獨立元件、各自持有自己的
// title/description/images 狀態，透過一個存在 useRef 的 registry 把「目前是否就緒／目前
// 資料」登記給父層，避免把所有列的表單狀態往上提升到父層（那樣會讓每個字元輸入都觸發整個
// 批量表單重新渲染）。
export function BatchItemForm({
  categories,
  cities,
  defaultCityId,
}: {
  categories: Array<{ id: string; name: string; slug: string }>;
  cities: Array<{ id: string; name: string }>;
  defaultCityId: string;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [cityId, setCityId] = useState(defaultCityId);
  const [rowIds, setRowIds] = useState<string[]>(() =>
    Array.from({ length: DEFAULT_ROWS }, nextRowId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const registryRef = useRef<Map<string, RowRegistryEntry>>(undefined);
  registryRef.current ??= new Map();
  // 移除的列要一併從 registry 清掉，避免送出時撈到已經不存在的舊資料。
  for (const key of Array.from(registryRef.current.keys())) {
    if (!rowIds.includes(key)) registryRef.current.delete(key);
  }
  function registerRow(rowId: string, entry: RowRegistryEntry) {
    registryRef.current?.set(rowId, entry);
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isSpecialCategory = selectedCategory
    ? SPECIAL_CATEGORY_SLUGS.has(selectedCategory.slug)
    : false;
  const allRowsReady = rowIds.every((id) => registryRef.current?.get(id)?.isReady() ?? false);

  const canSubmit = !!categoryId && !!cityId && !isSpecialCategory && allRowsReady && !submitting;

  function addRow() {
    setRowIds((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, nextRowId()]));
  }

  function removeRow(rowId: string) {
    setRowIds((prev) => (prev.length <= MIN_ROWS ? prev : prev.filter((id) => id !== rowId)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");
    setRowErrors({});

    try {
      const items = rowIds.map((id) => registryRef.current?.get(id)?.getPayload());
      const res = await fetch("/api/items/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, cityId, items }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        router.push("/items");
        router.refresh();
      } else if (Array.isArray(data?.error?.details)) {
        const next: Record<number, string> = {};
        for (const d of data.error.details as Array<{ index: number; message: string }>) {
          next[d.index] = d.message;
        }
        setRowErrors(next);
        setFormError(data?.error?.message ?? "有欄位未通過驗證，請修正後整批重新送出");
        setSubmitting(false);
      } else {
        setFormError(data?.error?.message ?? "批量上架失敗，請再試一次");
        setSubmitting(false);
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="batch-category">分類</Label>
          <select
            id="batch-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          >
            <option value="">請選擇</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {isSpecialCategory && (
            <p className="text-xs text-destructive">
              「{selectedCategory?.name}
              」有專屬欄位（券碼／到期日／法定警示等），請改到一般表單個別上架。
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-city">縣市</Label>
          <select
            id="batch-city"
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            required
            className="h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          >
            <option value="">請選擇</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!isSpecialCategory && (
        <div className="space-y-4">
          {rowIds.map((id, index) => (
            <BatchRow
              key={id}
              rowId={id}
              index={index}
              register={registerRow}
              onRemove={() => removeRow(id)}
              canRemove={rowIds.length > MIN_ROWS}
              error={rowErrors[index]}
            />
          ))}
          {rowIds.length < MAX_ROWS && (
            <Button type="button" variant="outline" onClick={addRow} className="w-full">
              ＋ 新增一列（{rowIds.length}/{MAX_ROWS}）
            </Button>
          )}
        </div>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" variant="brand" size="xl" disabled={!canSubmit} className="w-full">
        {submitting ? "發布中…" : `一次發布 ${rowIds.length} 筆好物`}
      </Button>
    </form>
  );
}

function BatchRow({
  rowId,
  index,
  register,
  onRemove,
  canRemove,
  error,
}: {
  rowId: string;
  index: number;
  register: (rowId: string, entry: RowRegistryEntry) => void;
  onRemove: () => void;
  canRemove: boolean;
  error?: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { images, addImages, removeImage, readyImages, hasUploading } =
    useImageUploadSlots(MAX_IMAGES_PER_ROW);

  const titleValid = title.trim().length >= 2 && title.trim().length <= 60;
  const descriptionValid = description.trim().length >= 1 && description.trim().length <= 1000;
  const isReady = titleValid && descriptionValid && readyImages.length >= 1 && !hasUploading;

  // 每次 render 都重新登記（覆蓋同一個 rowId 的舊 entry）：確保父層送出時讀到的是目前
  // render 對應的最新 title/description/images 閉包，不需要額外的 useEffect 同步。
  register(rowId, {
    isReady: () => isReady,
    getPayload: () => ({
      title: title.trim(),
      description: description.trim(),
      images: readyImages.map((img) => ({
        thumbObjectId: img.thumbObjectId,
        mediumObjectId: img.mediumObjectId,
      })),
    }),
  });

  return (
    <div className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">第 {index + 1} 筆</p>
        {canRemove && (
          <Button type="button" variant="outline" onClick={onRemove}>
            移除這列
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`batch-title-${rowId}`}>標題（2–60 字）</Label>
        <Input
          id={`batch-title-${rowId}`}
          className="h-11"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={2}
          maxLength={60}
          placeholder="例：恆溫快煮壺（全新）"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`batch-description-${rowId}`}>分享的話</Label>
        <textarea
          id={`batch-description-${rowId}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="說說為什麼想分享這個好物"
          required
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`batch-images-${rowId}`}>
          圖片（{images.length}/{MAX_IMAGES_PER_ROW}）
        </Label>
        <ImageUploadGrid
          images={images}
          maxImages={MAX_IMAGES_PER_ROW}
          onAdd={addImages}
          onRemove={removeImage}
          inputId={`batch-images-${rowId}`}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
