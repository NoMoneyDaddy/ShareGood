import { DealInfoStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

// M9 好康資訊與券票點強化（master-plan.md §9a 交付內容 1／2）：DealInfo 是「純資訊、
// 無實體交付」的新內容類型，獨立成表、不進 claims/handover 狀態機，與 Item 平行。
// 這支模組集中放狀態機／失效回報「輪次」推導／列表查詢／必顯示文案常數，供
// API route 與前台頁面共用（比照 src/lib/items.ts、src/lib/restrictions.ts 既有慣例）。

// ===== 標配免責文案（master-plan §9a 交付內容 1／§6 必寫清單第 1、2 項） =====
// 交付內容 1 明確要求 DealInfo 詳情頁「標配免責」；非官方合作聲明屬交付內容 6（文案套用）
// 範圍，但該項本身也列出 DealInfo 詳情頁是必須出現的頁面之一，且 SiteFooter 已經在全站
// 顯示過一次——這裡不重寫 SiteFooter，只是讓 DealInfo 詳情頁面本身也直接可見這兩句話，
// 不必依賴使用者往下捲到頁尾。
export const DEAL_INFO_DISCLAIMER =
  "優惠與兌換條件可能隨時變動，實際內容以發行商家最新公告及現場為準。";
export const DEAL_INFO_NON_AFFILIATION_NOTICE =
  "本平台所提及之商店名稱、品牌及商標均屬各權利人所有；除另有標示外，本平台與各品牌並無合作、授權或從屬關係。";

// ===== 狀態機（DealInfoStatus；master-plan §9a：跳態或逆向轉換一律 409，比照 M2 檢舉狀態機） =====
// 完整狀態圖（含系統觸發的轉換，僅供參考／測試對照，不直接當作任何單一端點的權限判斷依據，
// 因為「誰能觸發」在每個轉換上並不相同——見下面 DEAL_INFO_HUMAN_TRANSITIONS 的說明）：
//   pending_review → published（審核核准）／pending_review → rejected（審核駁回，終態）
//   published → stale（失效回報達門檻，系統自動）
//   stale → published（reactivate）
//   published/stale → expired（硬性 TTL job，系統觸發）
//   expired／rejected 為終態
export const DEAL_INFO_ALL_TRANSITIONS: Record<DealInfoStatus, DealInfoStatus[]> = {
  pending_review: [DealInfoStatus.published, DealInfoStatus.rejected],
  published: [DealInfoStatus.stale, DealInfoStatus.expired],
  stale: [DealInfoStatus.published, DealInfoStatus.expired],
  expired: [],
  rejected: [],
};

// PATCH /api/deal-infos/[id] 只暴露「人為操作」的轉換：審核核准/駁回、reactivate。
// published→stale（失效回報達門檻）與 published/stale→expired（硬性 TTL）刻意不放進這裡
// ——它們分別由 POST .../stale-reports 內部的門檻判斷、與 deal-info-expiration job
// 觸發，不是任何人可以直接呼叫 API 指定 nextStatus 就轉過去的操作，即使呼叫者是
// moderator/admin 也一樣（沒有「人工手動標記 stale/expired」這個操作，避免繞過機制本身）。
export const DEAL_INFO_HUMAN_TRANSITIONS: Partial<Record<DealInfoStatus, DealInfoStatus[]>> = {
  pending_review: [DealInfoStatus.published, DealInfoStatus.rejected],
  stale: [DealInfoStatus.published],
};

// ===== 失效回報門檻 =====
// 環境變數未設定時預設 3；「門檻 ≥2 才生效，避免單人殺文」——設定成 0/1 視為停用自動轉
// stale（回傳 null 讓呼叫端知道「這個機制目前關閉」，而不是硬套一個會被單人觸發的門檻）。
export function getDealStaleThreshold(): number | null {
  const raw = process.env.DEAL_STALE_THRESHOLD;
  const parsed = raw ? Number.parseInt(raw, 10) : 3;
  if (!Number.isFinite(parsed) || parsed < 2) return null;
  return parsed;
}

// ===== 失效回報「輪次」推導 =====
// schema 地基（PR #44）的 deal_info_reports.round 只記錄「這筆回報屬於第幾輪」，DealInfo
// 本身沒有（也不能新增，本次任務範圍限制只能加索引）一個「目前是第幾輪」的欄位。
// 這裡比照 M5 抽籤重用 ClaimComment 的既定做法：不新增資料表/欄位，改用已經因為治理需求
// （writeAudit）必須寫入的既有 audit_logs 表反推——reactivate 動作每次都會寫一筆
// action="deal_info.reactivate" 的 audit log（見 PATCH /api/deal-infos/[id]），因此
// 「目前輪次」= 1 + 這個 DealInfo 曾經被 reactivate 過幾次。reactivate 之後、下一筆
// 回報會拿到新的（遞增的）round，不會撞到舊輪次已經用掉的 unique(dealInfoId, reporterId,
// round)，同時舊輪次的回報列完整保留（稽核可查），完全符合驗收清單「round +1、本輪回報
// 計數歸零、舊回報列仍在」的要求。
export async function getCurrentDealInfoRound(dealInfoId: string): Promise<number> {
  const reactivateCount = await db.auditLog.count({
    where: { targetType: "deal_info", targetId: dealInfoId, action: "deal_info.reactivate" },
  });
  return reactivateCount + 1;
}

// ===== 列表查詢（GET /api/deal-infos 與 /deal-infos 瀏覽頁共用，比照 src/lib/items.ts 慣例） =====
export const DEAL_INFO_LIST_DEFAULT_PAGE_SIZE = 20;
export const DEAL_INFO_LIST_MAX_PAGE_SIZE = 50;

export type ListDealInfosParams = {
  cityId?: string;
  cursor?: string;
  limit?: number;
};

export type ListedDealInfo = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  isNationwide: boolean;
  verifiedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  dealSourceName: string | null;
  cities: string[];
};

export type ListDealInfosResult = {
  dealInfos: ListedDealInfo[];
  nextCursor: string | null;
};

// 只列出 published（比照 items 列表只顯示 published，stale/expired/pending_review/rejected
// 都只透過詳情頁直接連結存取，不進公開瀏覽列表——stale 代表「已有人回報疑似失效」，公開列表
// 隱藏可避免使用者持續點進已經不可信的內容，但保留詳情頁可見以便原投稿者/moderator 判斷是否
// reactivate）。縣市篩選：該縣市的 DealInfo 或全台適用的 DealInfo 皆算命中。
export async function listPublishedDealInfos(
  params: ListDealInfosParams,
): Promise<ListDealInfosResult> {
  const take =
    params.limit && params.limit > 0
      ? Math.min(params.limit, DEAL_INFO_LIST_MAX_PAGE_SIZE)
      : DEAL_INFO_LIST_DEFAULT_PAGE_SIZE;

  const where = {
    status: DealInfoStatus.published,
    ...(params.cityId
      ? { OR: [{ isNationwide: true }, { cities: { some: { cityId: params.cityId } } }] }
      : {}),
  };

  const dealInfos = await db.dealInfo.findMany({
    where,
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: take + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      summary: true,
      sourceUrl: true,
      isNationwide: true,
      verifiedAt: true,
      expiresAt: true,
      createdAt: true,
      dealSource: { select: { name: true } },
      cities: { select: { city: { select: { name: true } } } },
    },
  });

  const hasMore = dealInfos.length > take;
  const page = hasMore ? dealInfos.slice(0, take) : dealInfos;

  return {
    dealInfos: page.map((d) => ({
      id: d.id,
      title: d.title,
      summary: d.summary,
      sourceUrl: d.sourceUrl,
      isNationwide: d.isNationwide,
      verifiedAt: d.verifiedAt,
      expiresAt: d.expiresAt,
      createdAt: d.createdAt,
      dealSourceName: d.dealSource?.name ?? null,
      cities: d.cities.map((c) => c.city.name),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
