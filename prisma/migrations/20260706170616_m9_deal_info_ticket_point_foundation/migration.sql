-- CreateEnum
CREATE TYPE "DealSourceType" AS ENUM ('user_submission', 'editorial');

-- CreateEnum
CREATE TYPE "DealInfoStatus" AS ENUM ('pending_review', 'published', 'stale', 'expired', 'rejected');

-- CreateEnum
CREATE TYPE "CouponUsageResult" AS ENUM ('usable', 'expired_or_used');

-- CreateTable
CREATE TABLE "deal_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "official_url" TEXT NOT NULL,
    "source_grade" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_infos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_type" "DealSourceType" NOT NULL,
    "deal_source_id" TEXT,
    "is_nationwide" BOOLEAN NOT NULL,
    "submitter_id" TEXT,
    "status" "DealInfoStatus" NOT NULL DEFAULT 'pending_review',
    "verified_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "stale_reported_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_info_cities" (
    "id" TEXT NOT NULL,
    "deal_info_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_info_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_info_reports" (
    "id" TEXT NOT NULL,
    "deal_info_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_info_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_usage_reports" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "result" "CouponUsageResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_usage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_details" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "ticket_type" TEXT NOT NULL,
    "origin_platform" TEXT NOT NULL,
    "event_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_details" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "point_platform" TEXT NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_infos_status_expires_at_idx" ON "deal_infos"("status", "expires_at");

-- CreateIndex
CREATE INDEX "deal_infos_status_created_at_idx" ON "deal_infos"("status", "created_at");

-- CreateIndex
CREATE INDEX "deal_info_cities_city_id_deal_info_id_idx" ON "deal_info_cities"("city_id", "deal_info_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_info_cities_deal_info_id_city_id_key" ON "deal_info_cities"("deal_info_id", "city_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_info_reports_deal_info_id_reporter_id_round_key" ON "deal_info_reports"("deal_info_id", "reporter_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_usage_reports_item_id_reporter_id_key" ON "coupon_usage_reports"("item_id", "reporter_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_details_item_id_key" ON "ticket_details"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_details_item_id_key" ON "point_details"("item_id");

-- AddForeignKey
ALTER TABLE "deal_infos" ADD CONSTRAINT "deal_infos_deal_source_id_fkey" FOREIGN KEY ("deal_source_id") REFERENCES "deal_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_infos" ADD CONSTRAINT "deal_infos_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_info_cities" ADD CONSTRAINT "deal_info_cities_deal_info_id_fkey" FOREIGN KEY ("deal_info_id") REFERENCES "deal_infos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_info_cities" ADD CONSTRAINT "deal_info_cities_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_info_reports" ADD CONSTRAINT "deal_info_reports_deal_info_id_fkey" FOREIGN KEY ("deal_info_id") REFERENCES "deal_infos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_info_reports" ADD CONSTRAINT "deal_info_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage_reports" ADD CONSTRAINT "coupon_usage_reports_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage_reports" ADD CONSTRAINT "coupon_usage_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_details" ADD CONSTRAINT "ticket_details_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_details" ADD CONSTRAINT "point_details_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
