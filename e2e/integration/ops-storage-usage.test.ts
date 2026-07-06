import { afterAll, describe, expect, it } from "vitest";
import { bytesMismatch, computeByItemStatusUsage } from "@/lib/storage-usage";
import { cleanupTestData, createTestUser } from "../support/auth";
import { db } from "../support/db";
import { createImagePair } from "../support/images";
import { createPublishedItem } from "../support/items";

// master-plan §8a 驗收清單（交付內容 2）：
// 「手動觸發 storage_usage_snapshot job：...故意製造一個『物品已下架但圖片未清』的測試
// 情境（把某個測試物品轉 removed_by_moderator 但不動它的 item_images），
// orphanedBytes／orphanedCount 正確抓到這筆用量」。
//
// 本機沒有 MinIO（見 PR 說明），沒辦法端到端測 `computeAndPersistStorageUsageSnapshot`
// 裡呼叫 ListObjectsV2 那段與「DB／MinIO 一致性交叉驗證」；這裡改成兩件事：
// 1. 直接測 DB 端「依物品狀態分類＋孤兒判定」這段純查詢邏輯（`computeByItemStatusUsage`），
//    這正是規格驗收清單裡「orphanedBytes／orphanedCount 正確抓到」實質要驗證的計算邏輯。
// 2. 直接測一致性交叉驗證的容忍度判斷（`bytesMismatch`），不需要資料庫或 MinIO。
//
// createImagePair（見 e2e/support/images.ts）固定 thumb 8,000 bytes + medium 300,000
// bytes，一組圖片共 308,000 bytes；createPublishedItem 內部用同一支 helper。
const BYTES_PER_ITEM_IMAGE_PAIR = 8_000 + 300_000;

describe("M8 storage 用量計算邏輯", () => {
  describe("computeByItemStatusUsage（DB 端依物品狀態分類＋孤兒判定）", () => {
    const userIds: string[] = [];

    it("已下架（removed_by_moderator）但圖片未清的物品，被正確計入孤兒用量；published 物品不算孤兒", async () => {
      const owner = await createTestUser({ label: "ops-storage-owner" });
      userIds.push(owner.id);

      const before = await computeByItemStatusUsage();
      const beforePublished = before.byItemStatus.published ?? 0;
      const beforeRemoved = before.byItemStatus.removed_by_moderator ?? 0;
      const beforeOrphanedBytes = before.orphanedBytes;
      const beforeOrphanedCount = before.orphanedCount;

      // 一個維持 published（不該算孤兒），一個轉 removed_by_moderator 但不動 item_images
      // （模擬規格描述的「已下架但圖片未清」情境）。
      await createPublishedItem(owner, { title: "ops-storage-published" });
      const removedItemId = await createPublishedItem(owner, { title: "ops-storage-removed" });
      await db.item.update({
        where: { id: removedItemId },
        data: { status: "removed_by_moderator" },
      });

      const after = await computeByItemStatusUsage();

      // published 分類的用量增加剛好一組圖片的 bytes（另一個物品已經轉走，不算進 published）。
      expect((after.byItemStatus.published ?? 0) - beforePublished).toBe(BYTES_PER_ITEM_IMAGE_PAIR);
      // removed_by_moderator 分類的用量增加剛好一組圖片的 bytes。
      expect((after.byItemStatus.removed_by_moderator ?? 0) - beforeRemoved).toBe(
        BYTES_PER_ITEM_IMAGE_PAIR,
      );
      // 孤兒用量（終態物品狀態）只計入 removed_by_moderator 那筆，published 的那組圖片不算孤兒。
      expect(after.orphanedBytes - beforeOrphanedBytes).toBe(BigInt(BYTES_PER_ITEM_IMAGE_PAIR));
      expect(after.orphanedCount - beforeOrphanedCount).toBe(2); // thumb + medium 兩個 StorageObject
    });

    it("expired／removed_by_user 也算終態孤兒；draft／reserved 不算", async () => {
      const owner = await createTestUser({ label: "ops-storage-terminal" });
      userIds.push(owner.id);

      const before = await computeByItemStatusUsage();

      const expiredItemId = await createPublishedItem(owner, { title: "ops-storage-expired" });
      await db.item.update({ where: { id: expiredItemId }, data: { status: "expired" } });

      const removedByUserItemId = await createPublishedItem(owner, {
        title: "ops-storage-removed-by-user",
      });
      await db.item.update({
        where: { id: removedByUserItemId },
        data: { status: "removed_by_user" },
      });

      const reservedItemId = await createPublishedItem(owner, { title: "ops-storage-reserved" });
      await db.item.update({ where: { id: reservedItemId }, data: { status: "reserved" } });

      const after = await computeByItemStatusUsage();

      expect(after.orphanedBytes - before.orphanedBytes).toBe(
        BigInt(BYTES_PER_ITEM_IMAGE_PAIR * 2), // expired + removed_by_user，不含 reserved
      );
      expect(after.orphanedCount - before.orphanedCount).toBe(4); // 2 個物品 × (thumb+medium)
      expect((after.byItemStatus.reserved ?? 0) - (before.byItemStatus.reserved ?? 0)).toBe(
        BYTES_PER_ITEM_IMAGE_PAIR,
      );
    });

    it("ItemImage 的 thumbObjectId／mediumObjectId 兩個 FK 都要算進去，不能只算一個", async () => {
      // 直接造一筆 ItemImage（不透過 API），驗證兩個 FK 各自不同 sizeBytes 時兩者都被加總，
      // 避免規格特別提醒的「只算其中一個漏算一半用量」的錯誤。
      const owner = await createTestUser({ label: "ops-storage-both-fk" });
      userIds.push(owner.id);
      const { cityId, categoryId } = await pickCityAndCategoryForTest();

      const before = await computeByItemStatusUsage();

      const item = await db.item.create({
        data: {
          ownerId: owner.id,
          title: "ops-storage-both-fk-item",
          description: "測試兩個 FK 都要算進去",
          categoryId,
          cityId,
          status: "draft",
        },
      });
      const images = await createImagePair(owner.id); // thumb 8,000 + medium 300,000
      await db.itemImage.create({
        data: {
          itemId: item.id,
          thumbObjectId: images.thumbObjectId,
          mediumObjectId: images.mediumObjectId,
          sortOrder: 0,
        },
      });

      const after = await computeByItemStatusUsage();
      expect((after.byItemStatus.draft ?? 0) - (before.byItemStatus.draft ?? 0)).toBe(
        BYTES_PER_ITEM_IMAGE_PAIR,
      );
    });

    async function pickCityAndCategoryForTest() {
      const [city, category] = await Promise.all([
        db.city.findFirstOrThrow({ orderBy: { sortOrder: "asc" } }),
        db.category.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
      ]);
      return { cityId: city.id, categoryId: category.id };
    }

    afterAll(async () => {
      await cleanupTestData(userIds);
    });
  });

  describe("bytesMismatch（DB／MinIO 一致性交叉驗證的容忍度判斷）", () => {
    it("差異在容忍度以內不算不一致", async () => {
      expect(bytesMismatch(BigInt(1_000_000), BigInt(1_005_000), 0.01)).toBe(false); // 差 0.5%
    });

    it("差異超過容忍度算不一致", async () => {
      expect(bytesMismatch(BigInt(1_000_000), BigInt(1_020_000), 0.01)).toBe(true); // 差 2%
    });

    it("兩者皆為 0 不算不一致", async () => {
      expect(bytesMismatch(BigInt(0), BigInt(0), 0.01)).toBe(false);
    });

    it("完全相等不算不一致", async () => {
      expect(bytesMismatch(BigInt(500_000), BigInt(500_000), 0.01)).toBe(false);
    });
  });
});
