import { describe, expect, it } from "vitest";
import { getContributionBadge, getRoleBadge } from "@/lib/badges";

// src/lib/badges.ts 是純函式（不碰 db、不碰 server），這批測試不需要 dev server 也不需要
// 資料庫，純粹驗證級距邊界與角色優先序這種「一次寫錯全站都錯」的邏輯。

describe("getContributionBadge：貢獻值級距邊界", () => {
  it("9 分未達最低級距（10），回傳 null（不顯示徽章）", () => {
    expect(getContributionBadge(9)).toBeNull();
  });

  it("0 分與負分（no_show 扣分後）同樣回傳 null", () => {
    expect(getContributionBadge(0)).toBeNull();
    expect(getContributionBadge(-5)).toBeNull();
  });

  it("10 分剛好達標，是新芽夥伴（sprout）", () => {
    const badge = getContributionBadge(10);
    expect(badge?.key).toBe("sprout");
    expect(badge?.label).toBe("新芽夥伴");
  });

  it("49 分仍是新芽夥伴（sprout），50 分才升級為熱心夥伴（warm）", () => {
    expect(getContributionBadge(49)?.key).toBe("sprout");
    expect(getContributionBadge(50)?.key).toBe("warm");
  });

  it("149 分仍是熱心夥伴（warm），150 分才升級為共享達人（expert）", () => {
    expect(getContributionBadge(149)?.key).toBe("warm");
    expect(getContributionBadge(150)?.key).toBe("expert");
  });

  it("499 分仍是共享達人（expert），500 分才升級為傳奇鄰居（legend）", () => {
    expect(getContributionBadge(499)?.key).toBe("expert");
    expect(getContributionBadge(500)?.key).toBe("legend");
  });

  it("遠超過 500 分仍是傳奇鄰居（沒有更高級距）", () => {
    expect(getContributionBadge(999_999)?.key).toBe("legend");
  });
});

describe("getRoleBadge：身份組徽章優先序與輸入正規化", () => {
  it("admin 與 moderator 同時存在時，優先顯示 admin", () => {
    const badge = getRoleBadge([{ role: "moderator" }, { role: "admin" }]);
    expect(badge?.role).toBe("admin");
    expect(badge?.label).toBe("管理團隊");
  });

  it("只有 moderator 時顯示社群管理徽章", () => {
    const badge = getRoleBadge([{ role: "moderator" }]);
    expect(badge?.role).toBe("moderator");
    expect(badge?.label).toBe("社群管理");
  });

  it("一般 user（無 admin/moderator 身份組）回傳 null", () => {
    expect(getRoleBadge([{ role: "user" }])).toBeNull();
    expect(getRoleBadge([])).toBeNull();
  });

  it("接受 { role: string }[] 型態輸入", () => {
    expect(getRoleBadge([{ role: "admin" }])?.role).toBe("admin");
  });

  it("接受 string[] 型態輸入（例如 API 回應序列化後只剩角色字串陣列）", () => {
    expect(getRoleBadge(["admin"])?.role).toBe("admin");
    expect(getRoleBadge(["moderator"])?.role).toBe("moderator");
    expect(getRoleBadge(["user"])).toBeNull();
  });

  it("混合陣列中同時有兩種型態元素也能正確判斷（防禦性測試）", () => {
    // normalizeRoles 對每個元素各自判斷 typeof，理論上呼叫端不會混用，但這裡確認
    // 不會因為型態不一致而整個判斷失效。
    expect(getRoleBadge([{ role: "moderator" }, "admin"] as never)?.role).toBe("admin");
  });

  it("非陣列輸入（null/undefined）視為沒有身份組，回傳 null 而不是丟例外", () => {
    expect(getRoleBadge(null as never)).toBeNull();
    expect(getRoleBadge(undefined as never)).toBeNull();
  });
});
