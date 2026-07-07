import { type NextRequest, NextResponse } from "next/server";
import { DealInfoStatus, DealSourceType } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AuthzError, requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { listPublishedDealInfos } from "@/lib/deal-info";
import { FEATURE_FLAGS, getFeatureFlag } from "@/lib/feature-flags";
import { checkKeywordBlocklist } from "@/lib/keyword-blocklist";
import { checkRateLimit, RateLimitExceededError } from "@/lib/rate-limit";
import { checkFullBlock, checkUserRestriction } from "@/lib/restrictions";

const TITLE_MAX = 100;
const SUMMARY_MAX = 2000;
const MAX_CITIES = 22; // 全台縣市總數（seed 資料），多選縣市不會超過這個數字

const SOURCE_TYPES = new Set<string>(Object.values(DealSourceType));

// POST /api/deal-infos 的日期解析比照 src/app/api/items/route.ts 既有慣例：表單傳來的是
// "YYYY-MM-DD" 純日期，明確用台北時區（+08:00）當天結束時刻解讀，避免用
// `new Date("YYYY-MM-DD")`（會解讀成 UTC 午夜）在非 UTC+8 伺服器時區把日期往前推一天。
const INVALID_DATE = Symbol("INVALID_DATE");

function parseExpiresAtDate(value: unknown): Date | typeof INVALID_DATE {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return INVALID_DATE;
  const parsed = new Date(`${value}T23:59:59.999+08:00`);
  if (Number.isNaN(parsed.getTime())) return INVALID_DATE;
  return parsed;
}

function parseCityIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CITIES) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) return null;
    ids.push(entry);
  }
  return [...new Set(ids)];
}

// POST /api/deal-infos — 建立 DealInfo（master-plan §9a 交付內容 1／2）。
// 任何登入使用者都可以投稿（source_type=user_submission，S3）；moderator/admin 也可以用
// source_type=editorial 人工收錄官方來源內容（S1，交付內容 2），此時必須指定 dealSourceId。
// sourceType 是必填的請求欄位而非後端自動推導——驗收清單明確把「來源類型」列為缺欄位需回
// 422 的必填項之一，所以即使伺服器最終仍會用它來決定分支，仍要求前端明確帶這個欄位、
// 缺漏或不合法值一律 422（而不是靜默用 dealSourceId 是否存在來反推）。
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthzError) return jsonError(e.code, "請先登入");
    throw e;
  }
  // 比照 POST /api/items：未完成 onboarding（無 profile）的使用者不能建立內容。
  if (!user.profile) {
    return jsonError("FORBIDDEN", "請先完成基本資料設定");
  }

  const blocked = await checkFullBlock(user.id);
  if (blocked.blocked) return jsonError("FORBIDDEN", blocked.message);

  // DealInfo 投稿性質上是「發布內容」，沿用既有 "posting" 限制動作（沒有替 DealInfo
  // 另外定義限制類型的必要——M2 既有的四種 RestrictionType 已經涵蓋這個語意）。
  const restriction = await checkUserRestriction(user.id, "posting");
  if (restriction.blocked) return jsonError("FORBIDDEN", restriction.message);

  const now = new Date();
  const body = await req.json().catch(() => null);

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const sourceType = typeof body?.sourceType === "string" ? body.sourceType : "";
  const isNationwide = body?.isNationwide === true;
  const dealSourceIdInput =
    typeof body?.dealSourceId === "string" && body.dealSourceId.length > 0
      ? body.dealSourceId
      : null;

  if (title.length < 2 || title.length > TITLE_MAX) {
    return jsonError("UNPROCESSABLE", `標題需為 2–${TITLE_MAX} 個字`);
  }
  if (summary.length < 1 || summary.length > SUMMARY_MAX) {
    return jsonError(
      "UNPROCESSABLE",
      `摘要需為 1–${SUMMARY_MAX} 個字（請自行轉述事實，不要複製官方圖文）`,
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return jsonError("UNPROCESSABLE", "來源連結需為有效的網址");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return jsonError("UNPROCESSABLE", "來源連結需為有效的網址");
  }
  if (!SOURCE_TYPES.has(sourceType)) {
    return jsonError("UNPROCESSABLE", "請指定有效的來源類型");
  }

  const isEditorial = sourceType === DealSourceType.editorial;
  if (isEditorial) {
    const roles = new Set(user.roles.map((r) => r.role));
    if (!roles.has("moderator") && !roles.has("admin")) {
      return jsonError("FORBIDDEN", "只有 moderator/admin 可以人工收錄官方來源內容");
    }
    if (!dealSourceIdInput) {
      return jsonError("UNPROCESSABLE", "人工收錄需指定來源");
    }
  } else if (dealSourceIdInput) {
    return jsonError("UNPROCESSABLE", "使用者投稿不可指定來源");
  }

  // 頻率限制只套用在使用者投稿：editorial 的 submitterId 為 null（見下方 create），
  // rate-limit.ts 的計數器以 submitterId 統計本來就數不到 editorial，這裡明確跳過讓
  // 語意一致——editorial 僅限 moderator/admin、且每筆建立都寫 audit_logs 可追溯，
  // 編輯一次收錄整批官方檔期不該被個人額度卡住。
  if (!isEditorial) {
    try {
      await checkRateLimit(user.id, "deal_info_create");
    } catch (e) {
      if (e instanceof RateLimitExceededError) return jsonError("RATE_LIMITED", e.message);
      throw e;
    }
  }

  let dealSource: { id: string } | null = null;
  if (isEditorial && dealSourceIdInput) {
    // isActive: true——已被後台停用的來源不得再關聯新的好康（停用語意要真的生效）。
    dealSource = await db.dealSource.findFirst({
      where: { id: dealSourceIdInput, isActive: true },
      select: { id: true },
    });
    if (!dealSource) return jsonError("UNPROCESSABLE", "無效的來源，或來源已停用");
  }

  let cityIds: string[] = [];
  if (!isNationwide) {
    const parsed = parseCityIds(body?.cityIds);
    if (!parsed) return jsonError("UNPROCESSABLE", "請選擇適用縣市或勾選「全台」");
    cityIds = parsed;
    const cities = await db.city.findMany({ where: { id: { in: cityIds } }, select: { id: true } });
    if (cities.length !== cityIds.length) {
      return jsonError("UNPROCESSABLE", "包含無效的縣市");
    }
  }

  const expiresAt = parseExpiresAtDate(body?.expiresAt);
  if (expiresAt === INVALID_DATE) {
    return jsonError("UNPROCESSABLE", "請填寫到期日");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return jsonError("UNPROCESSABLE", "到期日需晚於現在");
  }

  const hitKeyword = (await checkKeywordBlocklist(title)) ?? (await checkKeywordBlocklist(summary));
  if (hitKeyword) {
    return jsonError("UNPROCESSABLE", "標題或摘要包含不允許的內容，請修改後再送出");
  }

  // 編輯（moderator/admin）自建的 DealInfo 一律直接 published、不進審核佇列；一般使用者
  // 投稿則依 REQUIRE_REVIEW flag 決定先進 pending_review 還是直接 published（比照 M2
  // 對物品上架的既有處理）。
  let initialStatus: DealInfoStatus = DealInfoStatus.published;
  if (!isEditorial) {
    const requireReview = await getFeatureFlag(FEATURE_FLAGS.REQUIRE_REVIEW);
    initialStatus = requireReview ? DealInfoStatus.pending_review : DealInfoStatus.published;
  }

  const created = await db.$transaction(async (tx) => {
    const dealInfo = await tx.dealInfo.create({
      data: {
        title,
        summary,
        sourceUrl,
        sourceType: sourceType as DealSourceType,
        dealSourceId: isEditorial ? dealSource?.id : null,
        isNationwide,
        // editorial 收錄可為 null（由編輯建立），比照 schema 註解說明的既定語意；即使建立者
        // 是登入中的 moderator，也不記錄成 submitter（避免跟「使用者投稿」的語意混淆）。
        submitterId: isEditorial ? null : user.id,
        status: initialStatus,
        verifiedAt: now,
        expiresAt,
        publishedAt: initialStatus === DealInfoStatus.published ? now : null,
      },
    });

    if (!isNationwide && cityIds.length > 0) {
      await tx.dealInfoCity.createMany({
        data: cityIds.map((cityId) => ({ dealInfoId: dealInfo.id, cityId })),
      });
    }

    return dealInfo;
  });

  // editorial 的 submitterId 刻意為 null（不與「使用者投稿」語意混淆），操作軌跡改由
  // audit_logs 承擔：不記 audit 的話，編輯收錄行為完全無法追溯（誰建了哪筆、何時）。
  if (isEditorial) {
    await writeAudit({
      actorId: user.id,
      action: "deal_info.create",
      targetType: "deal_info",
      targetId: created.id,
      detail: { title, sourceUrl, dealSourceId: dealSource?.id ?? null },
    });
  }

  return NextResponse.json({ id: created.id, status: created.status }, { status: 201 });
}

// GET /api/deal-infos — 公開好康列表（cursor 分頁＋縣市/全台篩選），比照 GET /api/items
// 既有慣例，查詢邏輯集中在 src/lib/deal-info.ts 供 API 與前台頁面共用。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cityId = searchParams.get("cityId") || undefined;
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);

  const result = await listPublishedDealInfos({
    cityId,
    cursor,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
  });

  return NextResponse.json(result);
}
