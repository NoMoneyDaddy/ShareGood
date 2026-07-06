import { Worker } from "node:worker_threads";
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

// heic-convert 底層是 libheif-js（WASM），解碼是 CPU 密集且同步阻塞事件循環（不會在
// 解碼過程中讓出）。預期流量規模是上千人同時在線，直接在主執行緒跑會讓同時上傳 HEIC
// 的使用者互相卡住、拖慢當下所有其他請求，所以搬進 Worker Thread。用 eval 字串（而非
// 獨立檔案路徑）啟動，避開 Next.js build 不會把獨立 worker 檔案編進輸出產物的問題；
// worker 內用 require() 走一般 node_modules 解析，正式站/本機開發都適用。
const HEIC_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const heicConvert = require("heic-convert");

(async () => {
  try {
    const jpeg = await heicConvert({
      buffer: Buffer.from(workerData.buffer),
      format: "JPEG",
      quality: workerData.quality,
    });
    parentPort.postMessage({ ok: true, buffer: Buffer.from(jpeg) });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
})();
`;

function convertHeicInWorker(buffer: Buffer, quality: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(HEIC_WORKER_SOURCE, { eval: true, workerData: { buffer, quality } });
    worker.once("message", (msg: { ok: true; buffer: Buffer } | { ok: false; error: string }) => {
      worker.terminate();
      if (msg.ok) resolve(msg.buffer);
      else reject(new Error(msg.error));
    });
    worker.once("error", (err) => {
      worker.terminate();
      reject(err);
    });
  });
}

/**
 * HEIC/HEIF（iPhone 相機預設格式）不在支援清單內，magic bytes 檢查前先轉成 JPEG，
 * 讓後續管線（sniff/壓縮/縮圖）統一處理，使用者端無感。非 HEIC 原樣回傳。
 */
export async function normalizeHeic(buffer: Buffer): Promise<Buffer> {
  if (!isHeic(buffer)) return buffer;
  return convertHeicInWorker(buffer, 0.92);
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
