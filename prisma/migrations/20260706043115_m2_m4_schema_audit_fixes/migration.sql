-- DropForeignKey
ALTER TABLE "item_removals" DROP CONSTRAINT "item_removals_moderator_id_fkey";

-- DropForeignKey
ALTER TABLE "coupon_reveal_logs" DROP CONSTRAINT "coupon_reveal_logs_revealed_by_fkey";

-- AlterTable
ALTER TABLE "item_removals" ALTER COLUMN "moderator_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "coupon_reveal_logs" ALTER COLUMN "revealed_by" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "item_removals" ADD CONSTRAINT "item_removals_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_reveal_logs" ADD CONSTRAINT "coupon_reveal_logs_revealed_by_fkey" FOREIGN KEY ("revealed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "telegram_updates_created_at_idx" ON "telegram_updates"("created_at");
