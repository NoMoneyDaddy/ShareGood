"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

const MAX_IMAGES = 5;

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
  const { images, addImages, removeImage, readyImages, hasUploading } =
    useImageUploadSlots(MAX_IMAGES);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // M3（master-plan §8）／M9（master-plan §9a）：優惠券／即期食品／票券／點數各自的額外欄位，
  // 依選到的分類 slug 決定要不要顯示。
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isCoupon = selectedCategory?.slug === COUPON_CATEGORY_SLUG;
  const isExpiringFood = selectedCategory?.slug === EXPIRING_FOOD_CATEGORY_SLUG;
  const isTicket = selectedCategory?.slug === TICKET_CATEGORY_SLUG;
  const isPoint = selectedCategory?.slug === POINT_CATEGORY_SLUG;

  const [expiresAt, setExpiresAt] = useState("");
  const [expiringFoodConfirmed, setExpiringFoodConfirmed] = useState(false);
  const [couponFaceValue, setCouponFaceValue] = useState("");
  const [couponMerchantName, setCouponMerchantName] = useState("");
  const [couponNotes, setCouponNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [ticketType, setTicketType] = useState("");
  const [ticketOriginPlatform, setTicketOriginPlatform] = useState("");
  const [ticketEventName, setTicketEventName] = useState("");
  const [pointPlatform, setPointPlatform] = useState("");
  const [pointAmount, setPointAmount] = useState("");

  const couponFieldsValid =
    !isCoupon ||
    (couponFaceValue.trim().length >= 1 &&
      couponMerchantName.trim().length >= 1 &&
      couponCode.trim().length >= 1 &&
      expiresAt.length > 0);
  const expiringFoodFieldsValid =
    !isExpiringFood || (expiringFoodConfirmed && expiresAt.length > 0);
  // M9 §9a 交付內容 4：票種／原平台為必填，活動名稱選填；到期日沿用既有 expiresAt 欄位
  // （不強制必填，票券可能沒有明確使用期限）。
  const ticketFieldsValid =
    !isTicket || (ticketType.trim().length >= 1 && ticketOriginPlatform.trim().length >= 1);
  // M9 §9a 交付內容 5：點數平台／數量為必填，數量須為正整數。
  const pointAmountNumber = Number.parseInt(pointAmount, 10);
  const pointFieldsValid =
    !isPoint ||
    (pointPlatform.trim().length >= 1 &&
      Number.isInteger(pointAmountNumber) &&
      pointAmountNumber > 0);
  const canSubmit =
    title.trim().length >= 2 &&
    description.trim().length >= 1 &&
    categoryId &&
    cityId &&
    readyImages.length >= 1 &&
    !hasUploading &&
    !submitting &&
    couponFieldsValid &&
    expiringFoodFieldsValid &&
    ticketFieldsValid &&
    pointFieldsValid;

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
          ...(isTicket
            ? {
                ticket: {
                  ticketType,
                  originPlatform: ticketOriginPlatform,
                  eventName: ticketEventName || undefined,
                },
              }
            : {}),
          ...(isPoint ? { point: { pointPlatform, pointAmount: pointAmountNumber } } : {}),
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
            className="h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-hidden focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20"
          >
            <option value="">請選擇</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {/* 「分類即類型」：券票點三類會切換成對應的專屬表單，選錯分類＝走錯上架流程，
              所以在選中時給一句說明；傢俱大型物則提醒搬運。 */}
          {isCoupon && (
            <p className="text-xs text-ink-soft">
              優惠券：有券碼或序號的折扣券，交接後才向接手者顯示券碼。
            </p>
          )}
          {isTicket && (
            <p className="text-xs text-ink-soft">
              電子票券：演出、展覽、交通等入場票券的無償轉贈（不是折扣券）。
            </p>
          )}
          {isPoint && (
            <p className="text-xs text-ink-soft">
              點數好康：會員點數的無償贈與媒合，實際移轉請走官方管道。
            </p>
          )}
          {selectedCategory?.slug === "furniture" && (
            <p className="text-xs text-ink-soft">
              大型傢俱請在描述註明尺寸與搬運方式，方便接手者評估。
            </p>
          )}
          {/* P1-1（2026-07-07 UX 走查）：食品雜貨選下去會強制填到期日＋食安確認子表單，
              先在選中分類當下說清楚，避免使用者以為「食品雜貨」只限即期品、選錯分類。 */}
          {isExpiringFood && (
            <p className="text-xs text-ink-soft">
              食品雜貨：不論保存期限長短，都需要填寫有效期限並確認包裝狀態（含即期食品）。
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">縣市</Label>
          <select
            id="city"
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

      {isCoupon && (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-medium text-ink">優惠券資訊</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="coupon-face-value">面額</Label>
              <Input
                id="coupon-face-value"
                className="h-11"
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
                className="h-11"
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
              className="h-11"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coupon-code">券碼</Label>
            <Input
              id="coupon-code"
              className="h-11"
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
          {/* P1-1：標題原為「即期食品規則」，即使分享的是離到期日還很久的食品（例如未拆封
              罐頭、調味料）也會出現，容易讓人誤以為選錯分類；改成通用措辭「食品資訊」，
              比照優惠券／票券／點數子表單「OO資訊」的既有命名慣例。食安確認勾選框文字與
              下方食安提示皆屬法務/食安凍結範圍，一字不動。 */}
          <p className="text-sm font-medium text-ink">食品資訊</p>
          <div className="space-y-2">
            <Label htmlFor="food-expires-at">到期日</Label>
            <Input
              id="food-expires-at"
              type="date"
              className="h-11"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </div>
          <label
            htmlFor="food-confirm"
            className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink-soft"
          >
            <input
              id="food-confirm"
              type="checkbox"
              checked={expiringFoodConfirmed}
              onChange={(e) => setExpiringFoodConfirmed(e.target.checked)}
              className="h-5 w-5 shrink-0 rounded border-line text-brand focus-visible:ring-3 focus-visible:ring-brand/20"
              required
            />
            我確認這項食品完整包裝、未開封、常溫保存、尚未過期。
          </label>
          {/* M9 §9a 交付內容 6：即期食品食安提示（借鏡 Olio），提示性、不強制擋，避免誤傷。 */}
          <p className="text-xs text-ink-soft">
            建議拍攝清楚的有效日期標籤照片，方便接手者確認效期。即期食品請於有效日期前食用完畢，實際狀況以外包裝標示為準。
          </p>
        </div>
      )}

      {isTicket && (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-medium text-ink">票券資訊</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ticket-type">券種</Label>
              <Input
                id="ticket-type"
                className="h-11"
                value={ticketType}
                onChange={(e) => setTicketType(e.target.value)}
                maxLength={50}
                placeholder="例：紙本入場券、序號券"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket-origin-platform">原平台</Label>
              <Input
                id="ticket-origin-platform"
                className="h-11"
                value={ticketOriginPlatform}
                onChange={(e) => setTicketOriginPlatform(e.target.value)}
                maxLength={50}
                placeholder="例：KKTIX、主辦官網"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-event-name">活動名稱（選填）</Label>
            <Input
              id="ticket-event-name"
              className="h-11"
              value={ticketEventName}
              onChange={(e) => setTicketEventName(e.target.value)}
              maxLength={100}
              placeholder="例：2026 夏季音樂節"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-expires-at">使用期限（選填）</Label>
            <Input
              id="ticket-expires-at"
              type="date"
              className="h-11"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-2 rounded-lg border border-brand/30 bg-brand-soft p-3 text-xs text-ink">
            <p>
              依文創法第 10 條之 1 及運動產業發展條例第 24 條之 1，以超過票面金額轉售票券可處票面 10
              至 50 倍罰鍰。本平台僅允許無償轉贈。
            </p>
            <p>
              本平台僅提供無償轉贈之資訊媒合，不經手、不保管、不擔保任何票券或優惠券之真偽與可兌換性；能否轉讓請依發行人使用條款。
            </p>
          </div>
        </div>
      )}

      {isPoint && (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4">
          <p className="text-sm font-medium text-ink">點數資訊</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="point-platform">點數平台</Label>
              <Input
                id="point-platform"
                className="h-11"
                value={pointPlatform}
                onChange={(e) => setPointPlatform(e.target.value)}
                maxLength={50}
                placeholder="例：FamiPoint、OPEN POINT"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="point-amount">點數數量</Label>
              <Input
                id="point-amount"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                className="h-11"
                value={pointAmount}
                onChange={(e) => setPointAmount(e.target.value)}
                placeholder="例：100"
                required
              />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-brand/30 bg-brand-soft p-3 text-xs text-ink">
            <p>
              點數轉贈依各平台官方規則，能否轉贈、次數與期限以官方 App
              為準；本平台不經手點數。實際轉移請雙方一律走官方 App 的轉贈功能完成。
            </p>
            <p>請勿在任何欄位或留言中填寫會員帳號、手機號碼、簡訊驗證碼等個人資料。</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="item-form-images">
          圖片（{images.length}/{MAX_IMAGES}）
        </Label>
        <ImageUploadGrid
          images={images}
          maxImages={MAX_IMAGES}
          onAdd={addImages}
          onRemove={removeImage}
          inputId="item-form-images"
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" variant="brand" size="xl" disabled={!canSubmit} className="w-full">
        {submitting ? "發布中…" : "發布好物"}
      </Button>
    </form>
  );
}
