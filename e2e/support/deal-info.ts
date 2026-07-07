import { api } from "./api";
import type { TestUser } from "./auth";
import { db } from "./db";

/** 隨便挑一個現成的縣市（seed 資料已經有，見 prisma/seed.ts）。 */
export async function pickCity() {
  const city = await db.city.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
  return city.id;
}

function futureDateString(daysFromNow = 30): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export { futureDateString };

/** 透過真的 POST /api/deal-infos 建立一則 DealInfo（跟正式流程走同一段驗證邏輯）。 */
export async function createDealInfo(
  submitter: TestUser,
  overrides: {
    title?: string;
    isNationwide?: boolean;
    cityIds?: string[];
    expiresAt?: string;
    sourceType?: "user_submission" | "editorial";
    dealSourceId?: string;
  } = {},
): Promise<{ id: string; status: string }> {
  const isNationwide = overrides.isNationwide ?? true;
  const res = await api("/api/deal-infos", {
    method: "POST",
    user: submitter,
    body: {
      title: overrides.title ?? "E2E 測試好康",
      summary: "整合測試用的假好康摘要內容",
      sourceUrl: "https://example.com/deal",
      sourceType: overrides.sourceType ?? "user_submission",
      ...(overrides.dealSourceId ? { dealSourceId: overrides.dealSourceId } : {}),
      isNationwide,
      ...(isNationwide ? {} : { cityIds: overrides.cityIds ?? [await pickCity()] }),
      expiresAt: overrides.expiresAt ?? futureDateString(),
    },
  });
  if (res.status !== 201) {
    throw new Error(`建立測試好康失敗：${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json as { id: string; status: string };
}

/** 清掉這次測試建立的所有 DealInfo（cascade 掉 deal_info_cities／deal_info_reports）。 */
export async function cleanupDealInfos(dealInfoIds: string[]): Promise<void> {
  if (dealInfoIds.length === 0) return;
  await db.dealInfo.deleteMany({ where: { id: { in: dealInfoIds } } });
}

/** 清掉這次測試建立的 DealSource。 */
export async function cleanupDealSources(dealSourceIds: string[]): Promise<void> {
  if (dealSourceIds.length === 0) return;
  await db.dealSource.deleteMany({ where: { id: { in: dealSourceIds } } });
}
