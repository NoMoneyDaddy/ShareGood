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
