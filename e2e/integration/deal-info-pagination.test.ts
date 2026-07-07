import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DEAL_INFO_COUNT, seedDealInfoData } from "../fixtures/seed-deal-info-data";
import { api } from "../support/api";
import { db } from "../support/db";

// master-plan §9a 驗收清單：「deal_infos 列表查詢（狀態＋縣市/全台篩選＋cursor 分頁）以
// 500+ 筆假資料跑 EXPLAIN ANALYZE，走 §11.2 新建索引（Index Scan，非 Seq Scan）
// ——比照 M1 驗收慣例」。
//
// GET /api/deal-infos 是這次任務補上的列表端點（見 src/app/api/deal-infos/route.ts、
// src/lib/deal-info.ts listPublishedDealInfos），查詢欄位對齊 deal_infos(status,
// created_at) 這條既有索引（schema 地基 PR #44 已建立）。
describe("好康資訊列表分頁與索引", () => {
  beforeAll(async () => {
    await seedDealInfoData(DEFAULT_DEAL_INFO_COUNT);
  }, 180_000);

  afterAll(async () => {
    await db.dealInfo.deleteMany({ where: { title: { startsWith: "壓測好康 #" } } });
  }, 180_000);

  it("預設分頁：每頁筆數符合上限、cursor 可以往下一頁翻且不重複", async () => {
    const page1 = await api("/api/deal-infos?limit=20");
    expect(page1.status).toBe(200);
    const body1 = page1.json as { dealInfos: Array<{ id: string }>; nextCursor: string | null };
    expect(body1.dealInfos).toHaveLength(20);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await api(`/api/deal-infos?limit=20&cursor=${body1.nextCursor}`);
    expect(page2.status).toBe(200);
    const body2 = page2.json as { dealInfos: Array<{ id: string }> };
    expect(body2.dealInfos).toHaveLength(20);

    const idsPage1 = new Set(body1.dealInfos.map((d) => d.id));
    for (const d of body2.dealInfos) {
      expect(idsPage1.has(d.id)).toBe(false);
    }
  });

  it("分頁上限：limit 超過 50 會被夾到 50", async () => {
    const res = await api("/api/deal-infos?limit=999");
    expect(res.status).toBe(200);
    const body = res.json as { dealInfos: unknown[] };
    expect(body.dealInfos.length).toBeLessThanOrEqual(50);
  });

  it("EXPLAIN ANALYZE：狀態＋排序這個主查詢沒有 Seq Scan on deal_infos", async () => {
    const rows = await db.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE
       SELECT id, title, status, created_at
       FROM deal_infos
       WHERE status = 'published'
       ORDER BY created_at DESC, id DESC
       LIMIT 21`,
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    console.log("\n--- EXPLAIN ANALYZE: /api/deal-infos 主查詢（狀態+排序） ---");
    console.log(plan);

    expect(plan).not.toMatch(/Seq Scan on deal_infos/);
    expect(plan).toMatch(/Index/);
  });
});
