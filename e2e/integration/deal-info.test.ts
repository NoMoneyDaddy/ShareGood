import { afterAll, describe, expect, it } from "vitest";
import { api, BASE_URL } from "../support/api";
import { cleanupTestData, createTestUser, grantRole, type TestUser } from "../support/auth";
import { db } from "../support/db";
import {
  cleanupDealInfos,
  cleanupDealSources,
  createDealInfo,
  futureDateString,
  pickCity,
} from "../support/deal-info";

// master-plan §9a 交付內容 1（資訊型好康 DealInfo）與交付內容 2（編輯人工收錄：
// 來源管理＋審核佇列）驗收清單：狀態機邊界、失效回報門檻與 round 機制、TTL job
// idempotent、權限邊界（404/403/422/409）。
describe("M9 DealInfo（好康資訊）", () => {
  const userIds: string[] = [];
  const dealInfoIds: string[] = [];
  const dealSourceIds: string[] = [];

  async function user(label: string): Promise<TestUser> {
    const u = await createTestUser({ label });
    userIds.push(u.id);
    return u;
  }

  async function moderator(label: string): Promise<TestUser> {
    const u = await user(label);
    await grantRole(u.id, "moderator");
    return u;
  }

  afterAll(async () => {
    await cleanupDealInfos(dealInfoIds);
    await cleanupDealSources(dealSourceIds);
    await cleanupTestData(userIds);
  });

  it("未登入建立 DealInfo → 401", async () => {
    const res = await api("/api/deal-infos", {
      method: "POST",
      body: { title: "測試", summary: "測試摘要", sourceUrl: "https://example.com" },
    });
    expect(res.status).toBe(401);
    expect((res.json as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("缺任一必填欄位（標題/摘要/來源連結/來源類型/縣市或全台/到期日）→ 422", async () => {
    const submitter = await user("deal-required-fields");
    const cityId = await pickCity();
    const base = {
      title: "測試好康標題",
      summary: "測試好康摘要內容",
      sourceUrl: "https://example.com/deal",
      sourceType: "user_submission",
      isNationwide: true,
      expiresAt: futureDateString(),
    };

    const cases: Array<[string, Record<string, unknown>]> = [
      ["缺標題", { ...base, title: "" }],
      ["缺摘要", { ...base, summary: "" }],
      ["缺來源連結", { ...base, sourceUrl: "" }],
      ["無效來源連結", { ...base, sourceUrl: "not-a-url" }],
      ["缺來源類型", { ...base, sourceType: "" }],
      ["缺到期日", { ...base, expiresAt: "" }],
      ["非全台但沒有縣市", { ...base, isNationwide: false, cityIds: [] }],
    ];

    for (const [label, body] of cases) {
      const res = await api("/api/deal-infos", { method: "POST", user: submitter, body });
      expect(res.status, label).toBe(422);
      expect((res.json as { error: { code: string } }).error.code, label).toBe("UNPROCESSABLE");
    }

    // sanity check：把上面刻意弄壞的欄位改對，同一組欄位應該能成功建立（證明上面失敗確實是
    // 因為被測的那個欄位，不是其他附帶原因）。
    const ok = await api("/api/deal-infos", {
      method: "POST",
      user: submitter,
      body: { ...base, cityIds: [cityId], isNationwide: false },
    });
    expect(ok.status).toBe(201);
    dealInfoIds.push((ok.json as { id: string }).id);
  });

  it("建立成功（user_submission，REQUIRE_REVIEW 關閉）：直接 published，顯示來源與查證日期", async () => {
    const submitter = await user("deal-create-ok");
    const title = `E2E 好康-${Date.now()}`;
    const created = await createDealInfo(submitter, { title });
    dealInfoIds.push(created.id);
    expect(created.status).toBe("published");

    const dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.submitterId).toBe(submitter.id);
    expect(dealInfo.publishedAt).not.toBeNull();
    expect(dealInfo.verifiedAt).not.toBeNull();

    const detail = await api(`/deal-infos/${created.id}`);
    expect(detail.status).toBe(200);
    const html = detail.json as unknown as string;
    // detail.json 對非 JSON 回應會退回原始文字（見 support/api.ts），這裡當 HTML 字串用。
    expect(String(html)).toContain(title);
    expect(String(html)).toContain("查證日期");
    expect(String(html)).toContain("以發行商家最新公告及現場為準");
  });

  it("一般使用者用 sourceType=editorial → 403；缺 dealSourceId → 422", async () => {
    const submitter = await user("deal-editorial-forbidden");
    const forbidden = await api("/api/deal-infos", {
      method: "POST",
      user: submitter,
      body: {
        title: "一般使用者想人工收錄",
        summary: "測試摘要",
        sourceUrl: "https://example.com",
        sourceType: "editorial",
        isNationwide: true,
        expiresAt: futureDateString(),
      },
    });
    expect(forbidden.status).toBe(403);

    const mod = await moderator("deal-editorial-missing-source");
    const missingSource = await api("/api/deal-infos", {
      method: "POST",
      user: mod,
      body: {
        title: "編輯忘記選來源",
        summary: "測試摘要",
        sourceUrl: "https://example.com",
        sourceType: "editorial",
        isNationwide: true,
        expiresAt: futureDateString(),
      },
    });
    expect(missingSource.status).toBe(422);
  });

  it("moderator 人工收錄（editorial）：直接 published、submitterId 為 null、關聯來源", async () => {
    const mod = await moderator("deal-editorial-ok");
    const source = await db.dealSource.create({
      data: {
        name: `測試來源-${Date.now()}`,
        officialUrl: "https://example.com/official",
        sourceGrade: "S1",
        lastCheckedAt: new Date(),
      },
    });
    dealSourceIds.push(source.id);

    const created = await createDealInfo(mod, {
      title: "編輯人工收錄的好康",
      sourceType: "editorial",
      dealSourceId: source.id,
    });
    dealInfoIds.push(created.id);
    expect(created.status).toBe("published");

    const dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.submitterId).toBeNull();
    expect(dealInfo.dealSourceId).toBe(source.id);
  });

  it("REQUIRE_REVIEW 開啟：投稿先進 pending_review，非投稿者/非 moderator 404，投稿者/moderator 可見", async () => {
    await db.featureFlag.upsert({
      where: { key: "REQUIRE_REVIEW" },
      update: { enabled: true },
      create: { key: "REQUIRE_REVIEW", enabled: true },
    });

    try {
      const submitter = await user("deal-review-submitter");
      const stranger = await user("deal-review-stranger");
      const mod = await moderator("deal-review-moderator");

      const created = await createDealInfo(submitter, { title: "待審核的好康" });
      dealInfoIds.push(created.id);
      expect(created.status).toBe("pending_review");

      const strangerRead = await api(`/deal-infos/${created.id}`, { user: stranger });
      expect(strangerRead.status).toBe(404);

      const anonRead = await api(`/deal-infos/${created.id}`);
      expect(anonRead.status).toBe(404);

      const submitterRead = await api(`/deal-infos/${created.id}`, { user: submitter });
      expect(submitterRead.status).not.toBe(404);

      const modRead = await api(`/deal-infos/${created.id}`, { user: mod });
      expect(modRead.status).not.toBe(404);
    } finally {
      await db.featureFlag.update({
        where: { key: "REQUIRE_REVIEW" },
        data: { enabled: false },
      });
    }
  });

  it("PATCH 審核：非 moderator 核准 → 403；moderator 核准 → published＋audit log；已終態不可再轉", async () => {
    await db.featureFlag.upsert({
      where: { key: "REQUIRE_REVIEW" },
      update: { enabled: true },
      create: { key: "REQUIRE_REVIEW", enabled: true },
    });

    try {
      const submitter = await user("deal-approve-submitter");
      const mod = await moderator("deal-approve-moderator");
      const created = await createDealInfo(submitter, { title: "等待核准的好康" });
      dealInfoIds.push(created.id);
      expect(created.status).toBe("pending_review");

      const forbidden = await api(`/api/deal-infos/${created.id}`, {
        method: "PATCH",
        user: submitter,
        body: { status: "published" },
      });
      expect(forbidden.status).toBe(403);

      const approved = await api(`/api/deal-infos/${created.id}`, {
        method: "PATCH",
        user: mod,
        body: { status: "published" },
      });
      expect(approved.status).toBe(200);
      expect((approved.json as { status: string }).status).toBe("published");

      const dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
      expect(dealInfo.publishedAt).not.toBeNull();

      const auditLog = await db.auditLog.findFirst({
        where: { targetType: "deal_info", targetId: created.id, action: "deal_info.approve" },
      });
      expect(auditLog).not.toBeNull();

      // published 是非終態，但這個狀態不在 DEAL_INFO_HUMAN_TRANSITIONS 允許清單裡
      // （published→stale/expired 只能靠系統機制觸發），human PATCH 一律 409。
      const noHumanTransition = await api(`/api/deal-infos/${created.id}`, {
        method: "PATCH",
        user: mod,
        body: { status: "stale" },
      });
      expect(noHumanTransition.status).toBe(409);
    } finally {
      await db.featureFlag.update({
        where: { key: "REQUIRE_REVIEW" },
        data: { enabled: false },
      });
    }
  });

  it("PATCH 駁回：pending_review → rejected 為終態，之後任何轉換皆 409", async () => {
    await db.featureFlag.upsert({
      where: { key: "REQUIRE_REVIEW" },
      update: { enabled: true },
      create: { key: "REQUIRE_REVIEW", enabled: true },
    });

    try {
      const submitter = await user("deal-reject-submitter");
      const mod = await moderator("deal-reject-moderator");
      const created = await createDealInfo(submitter, { title: "會被駁回的好康" });
      dealInfoIds.push(created.id);

      const rejected = await api(`/api/deal-infos/${created.id}`, {
        method: "PATCH",
        user: mod,
        body: { status: "rejected" },
      });
      expect(rejected.status).toBe(200);
      expect((rejected.json as { status: string }).status).toBe("rejected");

      const auditLog = await db.auditLog.findFirst({
        where: { targetType: "deal_info", targetId: created.id, action: "deal_info.reject" },
      });
      expect(auditLog).not.toBeNull();

      const afterReject = await api(`/api/deal-infos/${created.id}`, {
        method: "PATCH",
        user: mod,
        body: { status: "published" },
      });
      expect(afterReject.status).toBe(409);
    } finally {
      await db.featureFlag.update({
        where: { key: "REQUIRE_REVIEW" },
        data: { enabled: false },
      });
    }
  });

  it("失效回報：門檻 3，兩個不同帳號回報仍 published，第三個轉 stale；同帳號同輪重複回報 409；moderator reactivate 後 round+1", async () => {
    const submitter = await user("deal-stale-submitter");
    const reporterA = await user("deal-stale-reporterA");
    const reporterB = await user("deal-stale-reporterB");
    const reporterC = await user("deal-stale-reporterC");
    const mod = await moderator("deal-stale-moderator");

    const created = await createDealInfo(submitter, { title: "會被回報失效的好康" });
    dealInfoIds.push(created.id);

    const reportA = await api(`/api/deal-infos/${created.id}/stale-reports`, {
      method: "POST",
      user: reporterA,
    });
    expect(reportA.status).toBe(200);
    expect((reportA.json as { becameStale: boolean }).becameStale).toBe(false);

    // 同一人同一輪重複回報 → 409（unique 擋下，不計入累計人數）。
    const duplicateReport = await api(`/api/deal-infos/${created.id}/stale-reports`, {
      method: "POST",
      user: reporterA,
    });
    expect(duplicateReport.status).toBe(409);

    const reportB = await api(`/api/deal-infos/${created.id}/stale-reports`, {
      method: "POST",
      user: reporterB,
    });
    expect(reportB.status).toBe(200);
    expect((reportB.json as { becameStale: boolean }).becameStale).toBe(false);

    let dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.status).toBe("published");

    const reportC = await api(`/api/deal-infos/${created.id}/stale-reports`, {
      method: "POST",
      user: reporterC,
    });
    expect(reportC.status).toBe(200);
    expect((reportC.json as { becameStale: boolean }).becameStale).toBe(true);

    dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.status).toBe("stale");
    expect(dealInfo.staleReportedAt).not.toBeNull();

    // 非投稿者/非 moderator 不能 reactivate。
    const strangerReactivate = await api(`/api/deal-infos/${created.id}`, {
      method: "PATCH",
      user: reporterA,
      body: { status: "published" },
    });
    expect(strangerReactivate.status).toBe(403);

    // moderator reactivate → published，round +1（本輪回報計數歸零：reporterA 這次能再回報一次）。
    const reactivated = await api(`/api/deal-infos/${created.id}`, {
      method: "PATCH",
      user: mod,
      body: { status: "published" },
    });
    expect(reactivated.status).toBe(200);

    dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.status).toBe("published");

    const reportsCountBeforeNewRound = await db.dealInfoReport.count({
      where: { dealInfoId: created.id },
    });
    expect(reportsCountBeforeNewRound).toBe(3); // 舊回報列仍在，稽核可查

    // reporterA 在新一輪可以再回報一次（不會被舊輪次的 unique 擋下）。
    const reportAAgain = await api(`/api/deal-infos/${created.id}/stale-reports`, {
      method: "POST",
      user: reporterA,
    });
    expect(reportAAgain.status).toBe(200);

    const totalReportsAfterNewRound = await db.dealInfoReport.count({
      where: { dealInfoId: created.id },
    });
    expect(totalReportsAfterNewRound).toBe(4);
  });

  it("只能對 published 的好康回報失效", async () => {
    await db.featureFlag.upsert({
      where: { key: "REQUIRE_REVIEW" },
      update: { enabled: true },
      create: { key: "REQUIRE_REVIEW", enabled: true },
    });
    try {
      const submitter = await user("deal-report-wrong-status-submitter");
      const reporter = await user("deal-report-wrong-status-reporter");
      const created = await createDealInfo(submitter, { title: "還在審核中的好康" });
      dealInfoIds.push(created.id);
      expect(created.status).toBe("pending_review");

      const res = await api(`/api/deal-infos/${created.id}/stale-reports`, {
        method: "POST",
        user: reporter,
      });
      expect(res.status).toBe(409);
    } finally {
      await db.featureFlag.update({ where: { key: "REQUIRE_REVIEW" }, data: { enabled: false } });
    }
  });

  it("硬性 TTL job：過期的 DealInfo 轉 expired；重複觸發不重複轉態（idempotent）；缺少/錯誤 CRON_SECRET → 401", async () => {
    const CRON_SECRET = process.env.CRON_SECRET;
    expect(CRON_SECRET).toBeTruthy();

    const submitter = await user("deal-ttl-submitter");
    const created = await createDealInfo(submitter, { title: "即將過期的好康" });
    dealInfoIds.push(created.id);

    await db.dealInfo.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    async function callJob(secret: string | undefined) {
      const res = await fetch(`${BASE_URL}/api/jobs/deal-info-expiration`, {
        method: "POST",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    }

    const unauthorized = await callJob("wrong-secret");
    expect(unauthorized.status).toBe(401);

    const firstRun = await callJob(CRON_SECRET);
    expect(firstRun.status).toBe(200);
    const firstBody = firstRun.json as { expiredCount: number };
    expect(firstBody.expiredCount).toBeGreaterThanOrEqual(1);

    const dealInfo = await db.dealInfo.findUniqueOrThrow({ where: { id: created.id } });
    expect(dealInfo.status).toBe("expired");

    // 重複觸發：這筆已經是 expired，不再符合 `status IN (published, stale)`，不會被重複計入。
    const secondRun = await callJob(CRON_SECRET);
    expect(secondRun.status).toBe(200);
  });

  it("/admin/deal-sources：非 moderator → 403（API）/404（頁面）；moderator 可 CRUD＋標記已查證寫 audit log", async () => {
    const regular = await user("deal-sources-regular");
    const mod = await moderator("deal-sources-moderator");

    const forbiddenApi = await api("/api/admin/deal-sources", { user: regular });
    expect(forbiddenApi.status).toBe(403);

    const forbiddenPage = await api("/admin/deal-sources", { user: regular });
    expect(forbiddenPage.status).toBe(404);

    const created = await api("/api/admin/deal-sources", {
      method: "POST",
      user: mod,
      body: {
        name: `測試來源-${Date.now()}`,
        officialUrl: "https://example.com/source",
        notes: "測試備註",
      },
    });
    expect(created.status).toBe(201);
    const sourceId = (created.json as { id: string }).id;
    dealSourceIds.push(sourceId);

    const list = await api("/api/admin/deal-sources", { user: mod });
    expect(list.status).toBe(200);
    const listBody = list.json as { sources: Array<{ id: string }> };
    expect(listBody.sources.some((s) => s.id === sourceId)).toBe(true);

    const markVerified = await api(`/api/admin/deal-sources/${sourceId}`, {
      method: "PATCH",
      user: mod,
      body: { markVerified: true },
    });
    expect(markVerified.status).toBe(200);
    const updated = markVerified.json as { lastCheckedAt: string };
    expect(updated.lastCheckedAt).toBeTruthy();

    const auditLog = await db.auditLog.findFirst({
      where: { targetType: "deal_source", targetId: sourceId, action: "deal_source.mark_verified" },
    });
    expect(auditLog).not.toBeNull();

    const moderatorPage = await api("/admin/deal-sources", { user: mod });
    expect(moderatorPage.status).toBe(200);
  });

  it("/admin/deal-reviews：非 moderator → 404；moderator → 200", async () => {
    const regular = await user("deal-reviews-regular");
    const mod = await moderator("deal-reviews-moderator");

    const forbidden = await api("/admin/deal-reviews", { user: regular });
    expect(forbidden.status).toBe(404);

    const allowed = await api("/admin/deal-reviews", { user: mod });
    expect(allowed.status).toBe(200);
  });
});
