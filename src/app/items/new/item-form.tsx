"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUPON_CATEGORY_SLUG, EXPIRING_FOOD_CATEGORY_SLUG } from "@/lib/categories";

const MAX_IMAGES = 5;

type ImageSlot = {
  key: string;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  thumbObjectId?: string;
  mediumObjectId?: string;
  error?: string;
};

export function ItemForm({
  categories,
  cities,
  defaultCityId,
}: {
  categories: Array<{ id: string; name: string; slug: string }>;
  cities: Array<{ id: string; name: string }>;
  defaultCityId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [cityId, setCityId] = useState(defaultCityId);
  const [images, setImages] = useState<ImageSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // M3（master-plan §8）：優惠券／即期食品各自的額外欄位，依選到的分類 slug 決定要不要顯示。
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isCoupon = selectedCategory?.slug === COUPON_CATEGORY_SLUG;
  const isExpiringFood = selectedCategory?.slug === EXPIRING_FOOD_CATEGORY_SLUG;

  const [expiresAt, setExpiresAt] = useState("");
  const [expiringFoodConfirmed, setExpiringFoodConfirmed] = useState(false);
  const [couponFaceValue, setCouponFaceValue] = useState("");
  const [couponMerchantName, setCouponMerchantName] = useState("");
  const [couponNotes, setCouponNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");

  // 追蹤本機選檔建立的 blob: 預覽連結，組件卸載時統一釋放，避免瀏覽器記憶體洩漏。
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function addImages(files: FileList | null) {
    if (!files) return;
    const room = MAX_IMAGES - images.length;
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
  const couponFieldsValid =
    !isCoupon ||
    (couponFaceValue.trim().length >= 1 &&
      couponMerchantName.trim().length >= 1 &&
      couponCode.trim().length >= 1 &&
      expiresAt.length > 0);
  const expiringFoodFieldsValid =
    !isExpiringFood || (expiringFoodConfirmed && expiresAt.length > 0);
  const canSubmit =
    title.trim().length >= 2 &&
    description.trim().length >= 1 &&
    categoryId &&
    cityId &&
    readyImages.length >= 1 &&
    !hasUploading &&
    !submitting &&
    couponFieldsValid &&
    expiringFoodFieldsValid;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          categoryId,
          cityId,
          images: readyImages.map((img) => ({
            thumbObjectId: img.thumbObjectId,
            mediumObjectId: img.mediumObjectId,
          })),
          ...(expiresAt ? { expiresAt } : {}),
          ...(isCoupon
            ? {
                coupon: {
                  faceValue: couponFaceValue,
                  merchantName: couponMerchantName,
                  notes: couponNotes || undefined,
                  code: couponCode,
                },
              }
            : {}),
          ...(isExpiringFood ? { expiringFoodConfirmed } : {}),
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        router.push(`/items/${data.id}`);
        router.refresh();
      } else {
        setFormError(data?.error?.message ?? "上架失敗，請再試一次");
        setSubmitting(false);
      }
    } catch {
      setFormError("網路連線異常，請再試一次");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">標題（2–60 字）</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={2}
          maxLength={60}
          placeholder="例：恆溫快煮壺（全新）"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">分享的話</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="說說為什麼想分享這個好物"
          required
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">分類</Label>
          <select
            id="category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          >
            <option value="">請選擇</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">縣市</Label>
          <select
            id="city"
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            required
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
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

      {isCoupon && (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-medium text-ink">優惠券資訊</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="coupon-face-value">面額</Label>
              <Input
                id="coupon-face-value"
                value={couponFaceValue}
                onChange={(e) => setCouponFaceValue(e.target.value)}
                maxLength={50}
                placeholder="例：$100 折價"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coupon-merchant">適用店家</Label>
              <Input
                id="coupon-merchant"
                value={couponMerchantName}
                onChange={(e) => setCouponMerchantName(e.target.value)}
                maxLength={50}
                placeholder="例：全家便利商店"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="coupon-expires-at">到期日</Label>
            <Input
              id="coupon-expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coupon-code">券碼</Label>
            <Input
              id="coupon-code"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              maxLength={200}
              placeholder="輸入券碼，加密後才會存起來"
              required
            />
            <p className="text-xs text-ink-soft">
              券碼會加密保存，只有接手者在交接開始後才看得到明文。
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="coupon-notes">使用限制備註（選填）</Label>
            <textarea
              id="coupon-notes"
              value={couponNotes}
              onChange={(e) => setCouponNotes(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="例：限單筆消費滿 500 元使用"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base text-ink shadow-sm outline-hidden placeholder:text-ink-soft focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
            />
          </div>
        </div>
      )}

      {isExpiringFood && (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-medium text-ink">即期食品規則</p>
          <div className="space-y-2">
            <Label htmlFor="food-expires-at">到期日</Label>
            <Input
              id="food-expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </div>
          <label htmlFor="food-confirm" className="flex items-start gap-2 text-sm text-ink-soft">
            <input
              id="food-confirm"
              type="checkbox"
              checked={expiringFoodConfirmed}
              onChange={(e) => setExpiringFoodConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              required
            />
            我確認這項食品完整包裝、未開封、常溫保存、尚未過期。
          </label>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="images">
          圖片（{images.length}/{MAX_IMAGES}）
        </Label>
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <div
              key={img.key}
              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-2"
            >
              {/* biome-ignore lint/performance/noImgElement: 本機選檔的暫時預覽（blob: URL），不是可最佳化的遠端圖片 */}
              <img src={img.previewUrl} alt="" className="h-full w-full object-cover" />
              {img.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-ink/40">
                  <Loader2 size={20} className="animate-spin text-white" aria-hidden="true" />
                </div>
              )}
              {img.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/80 p-1 text-center text-[10px] text-white">
                  {img.error}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeImage(img.key)}
                aria-label="移除這張圖片"
                className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/60 text-white"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <label className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-ink-soft">
              <span className="text-lg leading-none">＋</span>
              新增
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  addImages(e.target.files);
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
        {submitting ? "發布中…" : "發布好物"}
      </Button>
    </form>
  );
}
