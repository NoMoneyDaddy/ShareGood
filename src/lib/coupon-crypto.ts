import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 券碼加密（master-plan.md §8）：只用 Node.js 內建 crypto 模組的 AES-256-GCM，不引入額外
// 加密函式庫、不自創演算法。金鑰來自環境變數 COUPON_SECRET_KEY（64 個 hex 字元＝32 bytes，
// 用 `openssl rand -hex 32` 產生，見 .env.example）。
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 建議 96-bit（12 bytes）IV
const KEY_LENGTH = 32; // AES-256 需要 32 bytes 金鑰

export class CouponCryptoConfigError extends Error {}

function loadKey(): Buffer {
  const raw = process.env.COUPON_SECRET_KEY;
  if (!raw) {
    throw new CouponCryptoConfigError("COUPON_SECRET_KEY 未設定，無法加密／解密券碼");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new CouponCryptoConfigError(
      `COUPON_SECRET_KEY 長度不正確：需為 ${KEY_LENGTH} bytes（64 個 hex 字元），實際為 ${key.length} bytes`,
    );
  }
  return key;
}

export type EncryptedCoupon = { ciphertext: string; iv: string; authTag: string };

// 加密券碼明文。IV 每次隨機產生，即使同一組券碼重複加密，密文也不會相同。
// 呼叫端（上架 API）拿到回傳值後直接存進 CouponSecret，明文絕不落地。
export function encryptCouponCode(plainCode: string): EncryptedCoupon {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainCode, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

// 解密券碼：只有 /api/items/[id]/coupon/reveal 這支已做過權限檢查的 API 會呼叫。
// 回傳值是明文，呼叫端必須確保不 console.log、不寫進任何非預期欄位。
export function decryptCouponCode(secret: EncryptedCoupon): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
