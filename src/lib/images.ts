import heicConvert from "heic-convert";
import sharp from "sharp";

// 圖片管線（master-plan §3.3）：驗 magic bytes → 去 EXIF → 壓縮 → thumb/medium
// 原圖一律不保留。

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

const MAGIC: Array<{
  mime: "image/jpeg" | "image/png" | "image/webp";
  check: (b: Buffer) => boolean;
}> = [
  { mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/webp",
    check: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

// ISO base media file format：偏移 4-8 是 "ftyp"，偏移 8-12 是 major brand。
// iPhone 相機（「高效率」設定）預設輸出這幾種 brand，Android 部分機種也會用 heic/heif。
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

function isHeic(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    HEIC_BRANDS.has(buffer.subarray(8, 12).toString("ascii"))
  );
}

/**
 * HEIC/HEIF（iPhone 相機預設格式）不在支援清單內，magic bytes 檢查前先轉成 JPEG，
 * 讓後續管線（sniff/壓縮/縮圖）統一處理，使用者端無感。非 HEIC 原樣回傳。
 */
export async function normalizeHeic(buffer: Buffer): Promise<Buffer> {
  if (!isHeic(buffer)) return buffer;
  const jpeg = await heicConvert({ buffer, format: "JPEG", quality: 0.92 });
  return Buffer.from(jpeg);
}

/** 用 magic bytes 判斷實際格式；不合法回 null（副檔名不可信）。 */
export function sniffImageMime(buffer: Buffer) {
  if (buffer.length < 12) return null;
  return MAGIC.find((m) => m.check(buffer))?.mime ?? null;
}

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
};

/**
 * 產生指定最大寬度的 webp 變體。
 * sharp 預設不帶入原 metadata（EXIF/GPS 一併移除）；.rotate() 先套用 EXIF 方向再丟棄之。
 */
export async function toWebpVariant(
  input: Buffer,
  maxWidth: number,
  quality: number,
): Promise<ProcessedImage> {
  const out = await sharp(input)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    sizeBytes: out.info.size,
  };
}

export const VARIANTS = {
  thumb: { maxWidth: 320, quality: 70 },
  medium: { maxWidth: 768, quality: 78 },
} as const;
