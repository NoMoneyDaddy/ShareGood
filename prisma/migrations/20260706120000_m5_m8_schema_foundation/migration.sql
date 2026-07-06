-- CreateEnum
CREATE TYPE "LotteryStatus" AS ENUM ('open', 'drawing', 'awaiting_confirmation', 'completed', 'failed_no_entries', 'cancelled');

-- CreateEnum
CREATE TYPE "LotteryEntryStatus" AS ENUM ('entered', 'cancelled');

-- CreateEnum
CREATE TYPE "LotteryResultStatus" AS ENUM ('pending', 'offered', 'confirmed', 'expired', 'declined');

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('data_export', 'account_deletion');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('submitted', 'cooling_off', 'confirmed', 'processing', 'completed', 'cancelled', 'rejected');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'ready', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('purge', 'anonymize', 'downgrade', 'archive');

-- CreateEnum
CREATE TYPE "LawEnforcementRequestStatus" AS ENUM ('submitted', 'legal_review', 'approved', 'rejected', 'fulfilled', 'closed');

-- CreateEnum
CREATE TYPE "LegalHoldStatus" AS ENUM ('active', 'released');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'web_push';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StorageKind" ADD VALUE 'law_enforcement_document';
ALTER TYPE "StorageKind" ADD VALUE 'law_enforcement_export';

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "last_attempt_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lotteries" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "entry_deadline" TIMESTAMP(3) NOT NULL,
    "status" "LotteryStatus" NOT NULL DEFAULT 'open',
    "seed" TEXT,
    "entry_snapshot" JSONB,
    "algo_version" TEXT,
    "drawn_at" TIMESTAMP(3),
    "current_rank" INTEGER,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lotteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_entries" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "LotteryEntryStatus" NOT NULL DEFAULT 'entered',
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "lottery_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_results" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "LotteryResultStatus" NOT NULL DEFAULT 'pending',
    "offered_at" TIMESTAMP(3),
    "confirm_deadline" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_audit_logs" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "immediate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "daily_digest_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_keywords" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "normalized_keyword" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_categories" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cities" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_matches" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "notified_via" TEXT,
    "digest_job_id" TEXT,

    CONSTRAINT "subscription_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_digest_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "digest_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_digest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "user_agent" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'submitted',
    "reason" TEXT,
    "cooling_off_until" TIMESTAMP(3),
    "processed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "privacy_request_id" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "storage_object_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_retention_policies" (
    "id" TEXT NOT NULL,
    "policy_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "retention_days" INTEGER,
    "action" "RetentionAction",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_purge_logs" (
    "id" TEXT NOT NULL,
    "policy_key" TEXT NOT NULL,
    "job_run_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action_taken" "RetentionAction" NOT NULL,
    "skipped_legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_purge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_enforcement_requests" (
    "id" TEXT NOT NULL,
    "agency_name" TEXT NOT NULL,
    "case_reference" TEXT NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "request_scope" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "LawEnforcementRequestStatus" NOT NULL DEFAULT 'submitted',
    "submitted_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notify_user" BOOLEAN NOT NULL DEFAULT true,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "law_enforcement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_enforcement_request_targets" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,

    CONSTRAINT "law_enforcement_request_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_enforcement_request_documents" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "storage_object_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "law_enforcement_request_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_enforcement_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "law_enforcement_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_enforcement_exports" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "storage_object_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "law_enforcement_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "related_request_id" TEXT,
    "status" "LegalHoldStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT NOT NULL,
    "released_by" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_hold_targets" (
    "id" TEXT NOT NULL,
    "legal_hold_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,

    CONSTRAINT "legal_hold_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_hold_events" (
    "id" TEXT NOT NULL,
    "legal_hold_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_hold_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_checks" (
    "id" TEXT NOT NULL,
    "subsystem" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "detail" JSONB,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "route_or_job" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_metrics" (
    "id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "is_slow" BOOLEAN NOT NULL,
    "context" JSONB,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_usage_snapshots" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "total_bytes" BIGINT NOT NULL,
    "object_count" INTEGER NOT NULL,
    "orphaned_bytes" BIGINT,
    "orphaned_count" INTEGER,
    "by_item_status" JSONB,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lotteries_item_id_key" ON "lotteries"("item_id");

-- CreateIndex
CREATE INDEX "lotteries_status_entry_deadline_idx" ON "lotteries"("status", "entry_deadline");

-- CreateIndex
CREATE INDEX "lottery_entries_lottery_id_status_idx" ON "lottery_entries"("lottery_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_entries_lottery_id_user_id_key" ON "lottery_entries"("lottery_id", "user_id");

-- CreateIndex
CREATE INDEX "lottery_results_status_confirm_deadline_idx" ON "lottery_results"("status", "confirm_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_results_lottery_id_rank_key" ON "lottery_results"("lottery_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_results_lottery_id_entry_id_key" ON "lottery_results"("lottery_id", "entry_id");

-- CreateIndex
CREATE INDEX "lottery_audit_logs_lottery_id_created_at_idx" ON "lottery_audit_logs"("lottery_id", "created_at");

-- CreateIndex
CREATE INDEX "user_subscriptions_user_id_idx" ON "user_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscription_keywords_subscription_id_idx" ON "subscription_keywords"("subscription_id");

-- CreateIndex
CREATE INDEX "subscription_keywords_normalized_keyword_idx" ON "subscription_keywords"("normalized_keyword");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_keywords_subscription_id_normalized_keyword_key" ON "subscription_keywords"("subscription_id", "normalized_keyword");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_categories_subscription_id_category_id_key" ON "subscription_categories"("subscription_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cities_subscription_id_city_id_key" ON "subscription_cities"("subscription_id", "city_id");

-- CreateIndex
CREATE INDEX "subscription_matches_notified_at_idx" ON "subscription_matches"("notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_matches_subscription_id_item_id_key" ON "subscription_matches"("subscription_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_digest_jobs_user_id_digest_date_key" ON "subscription_digest_jobs"("user_id", "digest_date");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_user_id_idx" ON "web_push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "privacy_requests_user_id_type_created_at_idx" ON "privacy_requests"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "privacy_requests_status_cooling_off_until_idx" ON "privacy_requests"("status", "cooling_off_until");

-- CreateIndex
CREATE UNIQUE INDEX "data_exports_privacy_request_id_key" ON "data_exports"("privacy_request_id");

-- CreateIndex
CREATE INDEX "data_exports_status_expires_at_idx" ON "data_exports"("status", "expires_at");

-- CreateIndex
CREATE INDEX "data_exports_user_id_created_at_idx" ON "data_exports"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_retention_policies_policy_key_key" ON "data_retention_policies"("policy_key");

-- CreateIndex
CREATE INDEX "data_purge_logs_policy_key_created_at_idx" ON "data_purge_logs"("policy_key", "created_at");

-- CreateIndex
CREATE INDEX "data_purge_logs_target_type_target_id_idx" ON "data_purge_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "law_enforcement_requests_status_created_at_idx" ON "law_enforcement_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "law_enforcement_request_targets_target_type_target_id_idx" ON "law_enforcement_request_targets"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "law_enforcement_request_targets_request_id_idx" ON "law_enforcement_request_targets"("request_id");

-- CreateIndex
CREATE INDEX "law_enforcement_request_documents_request_id_idx" ON "law_enforcement_request_documents"("request_id");

-- CreateIndex
CREATE INDEX "law_enforcement_request_documents_storage_object_id_idx" ON "law_enforcement_request_documents"("storage_object_id");

-- CreateIndex
CREATE INDEX "law_enforcement_request_events_request_id_created_at_idx" ON "law_enforcement_request_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "law_enforcement_exports_request_id_idx" ON "law_enforcement_exports"("request_id");

-- CreateIndex
CREATE INDEX "legal_holds_status_idx" ON "legal_holds"("status");

-- CreateIndex
CREATE INDEX "legal_hold_targets_target_type_target_id_idx" ON "legal_hold_targets"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "legal_hold_targets_legal_hold_id_idx" ON "legal_hold_targets"("legal_hold_id");

-- CreateIndex
CREATE INDEX "legal_hold_events_legal_hold_id_created_at_idx" ON "legal_hold_events"("legal_hold_id", "created_at");

-- CreateIndex
CREATE INDEX "health_checks_subsystem_checked_at_idx" ON "health_checks"("subsystem", "checked_at");

-- CreateIndex
CREATE INDEX "error_logs_source_occurred_at_idx" ON "error_logs"("source", "occurred_at");

-- CreateIndex
CREATE INDEX "performance_metrics_metric_type_label_recorded_at_idx" ON "performance_metrics"("metric_type", "label", "recorded_at");

-- CreateIndex
CREATE INDEX "performance_metrics_is_slow_recorded_at_idx" ON "performance_metrics"("is_slow", "recorded_at");

-- CreateIndex
CREATE INDEX "storage_usage_snapshots_bucket_snapshot_at_idx" ON "storage_usage_snapshots"("bucket", "snapshot_at");

-- AddForeignKey
ALTER TABLE "lotteries" ADD CONSTRAINT "lotteries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotteries" ADD CONSTRAINT "lotteries_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_entries" ADD CONSTRAINT "lottery_entries_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_entries" ADD CONSTRAINT "lottery_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_results" ADD CONSTRAINT "lottery_results_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_results" ADD CONSTRAINT "lottery_results_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "lottery_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_results" ADD CONSTRAINT "lottery_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_audit_logs" ADD CONSTRAINT "lottery_audit_logs_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_audit_logs" ADD CONSTRAINT "lottery_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_keywords" ADD CONSTRAINT "subscription_keywords_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_categories" ADD CONSTRAINT "subscription_categories_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_categories" ADD CONSTRAINT "subscription_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cities" ADD CONSTRAINT "subscription_cities_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cities" ADD CONSTRAINT "subscription_cities_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_matches" ADD CONSTRAINT "subscription_matches_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_matches" ADD CONSTRAINT "subscription_matches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_matches" ADD CONSTRAINT "subscription_matches_digest_job_id_fkey" FOREIGN KEY ("digest_job_id") REFERENCES "subscription_digest_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_digest_jobs" ADD CONSTRAINT "subscription_digest_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_privacy_request_id_fkey" FOREIGN KEY ("privacy_request_id") REFERENCES "privacy_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_retention_policies" ADD CONSTRAINT "data_retention_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_purge_logs" ADD CONSTRAINT "data_purge_logs_job_run_id_fkey" FOREIGN KEY ("job_run_id") REFERENCES "system_job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_requests" ADD CONSTRAINT "law_enforcement_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_requests" ADD CONSTRAINT "law_enforcement_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_targets" ADD CONSTRAINT "law_enforcement_request_targets_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "law_enforcement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_documents" ADD CONSTRAINT "law_enforcement_request_documents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "law_enforcement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_documents" ADD CONSTRAINT "law_enforcement_request_documents_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_documents" ADD CONSTRAINT "law_enforcement_request_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_events" ADD CONSTRAINT "law_enforcement_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "law_enforcement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_request_events" ADD CONSTRAINT "law_enforcement_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_exports" ADD CONSTRAINT "law_enforcement_exports_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "law_enforcement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_enforcement_exports" ADD CONSTRAINT "law_enforcement_exports_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_related_request_id_fkey" FOREIGN KEY ("related_request_id") REFERENCES "law_enforcement_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_hold_targets" ADD CONSTRAINT "legal_hold_targets_legal_hold_id_fkey" FOREIGN KEY ("legal_hold_id") REFERENCES "legal_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_hold_events" ADD CONSTRAINT "legal_hold_events_legal_hold_id_fkey" FOREIGN KEY ("legal_hold_id") REFERENCES "legal_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_hold_events" ADD CONSTRAINT "legal_hold_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

