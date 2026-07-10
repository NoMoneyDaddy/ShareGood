-- AlterTable
ALTER TABLE "handover_records" ADD COLUMN     "reminder_sent_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "leaderboard_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "handover_ratings" (
    "id" TEXT NOT NULL,
    "handover_record_id" TEXT NOT NULL,
    "rater_id" TEXT NOT NULL,
    "ratee_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_ratings_ratee_id_created_at_idx" ON "handover_ratings"("ratee_id", "created_at");

-- CreateIndex
CREATE INDEX "handover_ratings_rater_id_created_at_idx" ON "handover_ratings"("rater_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "handover_ratings_handover_record_id_rater_id_key" ON "handover_ratings"("handover_record_id", "rater_id");

-- CreateIndex
CREATE INDEX "item_favorites_user_id_created_at_idx" ON "item_favorites"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "item_favorites_item_id_idx" ON "item_favorites"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_favorites_user_id_item_id_key" ON "item_favorites"("user_id", "item_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "handover_records_status_scheduled_at_idx" ON "handover_records"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "handover_ratings" ADD CONSTRAINT "handover_ratings_handover_record_id_fkey" FOREIGN KEY ("handover_record_id") REFERENCES "handover_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_ratings" ADD CONSTRAINT "handover_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_ratings" ADD CONSTRAINT "handover_ratings_ratee_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_favorites" ADD CONSTRAINT "item_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_favorites" ADD CONSTRAINT "item_favorites_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 資料完整性 CHECK constraint（採納 review 建議，DB 層 defense in depth；功能實作 wave 的
-- API 層仍會各自驗證）：評分限 1–5 星、封鎖不可指向自己。Prisma schema 不管理 CHECK，
-- 這兩條為手動 raw SQL（Prisma 官方對 CHECK 的建議做法）。
ALTER TABLE "handover_ratings" ADD CONSTRAINT "handover_ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_no_self_block" CHECK ("blocker_id" <> "blocked_id");
