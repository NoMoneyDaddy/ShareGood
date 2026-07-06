export const TAIPEI_DATETIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  dateStyle: "short",
  timeStyle: "medium",
});

export function formatTaipeiDateTime(date: Date): string {
  return TAIPEI_DATETIME_FORMATTER.format(date);
}

/** 位元組數轉成人類可讀格式（MB/GB），儀表板顯示用。 */
export function formatBytes(bytes: number | string): string {
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export const STATUS_LABEL: Record<string, string> = {
  up: "正常",
  degraded: "降級",
  down: "中斷",
};

export const STATUS_DOT_CLASS: Record<string, string> = {
  up: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
};
