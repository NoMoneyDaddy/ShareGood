const TAIPEI_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" });

/** 台北時區的日期 key（YYYY-MM-DD），跟 UTC 時間戳記脫鉤，只用來做「同一天」的分桶比對。 */
export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_KEY_FORMATTER.format(date);
}

/** 日期 key 轉成圖表 x 軸的短格式（例如 7/7），日期部分不受時區影響，直接切字串即可。 */
export function dayKeyToLabel(key: string): string {
  const [, month, day] = key.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 近 N 天（含今天）的台北時區日期 key 陣列，由舊到新排序，用來補齊沒有資料的日期。 */
export function lastNDayKeys(n: number, now: Date = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getTime() - (n - 1 - i) * 24 * 60 * 60 * 1000);
    return taipeiDateKey(d);
  });
}
