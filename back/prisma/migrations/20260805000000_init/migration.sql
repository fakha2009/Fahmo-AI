-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'VALIDATING', 'PROCESSING', 'NEEDS_CLARIFICATION', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnalysisStage" AS ENUM ('QUEUED', 'VALIDATING', 'PREPARING_FILES', 'EXTRACTING_CONTENT', 'DETECTING_DOCUMENT_TYPE', 'ANALYZING', 'CHECKING_RESULT', 'NORMALIZING', 'SAVING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('TEXT', 'IMAGE', 'PDF', 'MULTI_IMAGE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ANNOUNCEMENT', 'WORK_ASSIGNMENT', 'HANDWRITTEN_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "OutputLanguage" AS ENUM ('RU', 'TG', 'EN');

-- CreateEnum
CREATE TYPE "ExplanationMode" AS ENUM ('STANDARD', 'SIMPLE');

-- CreateEnum
CREATE TYPE "RetentionMode" AS ENUM ('HISTORY', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "SourcePreviewMode" AS ENUM ('HISTORY', 'TEMPORARY', 'NO_PREVIEW');

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "TextScale" AS ENUM ('NORMAL', 'LARGE');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'WEB_PUSH', 'CALENDAR');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('OPEN', 'ANSWERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AIRunOperation" AS ENUM ('ANALYZE_DOCUMENT', 'ANALYZE_TEXT', 'ANSWER_CLARIFICATION', 'REANALYZE');

-- CreateEnum
CREATE TYPE "AIRunStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('AI', 'USER', 'CLARIFICATION', 'REANALYZE');

-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('PDF', 'DATA');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SESSION', 'USER', 'SYSTEM', 'PUBLIC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "preferred_language" TEXT,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnonymousSession" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "AnonymousSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "interface_language" "OutputLanguage" NOT NULL DEFAULT 'RU',
    "output_language" "OutputLanguage" NOT NULL DEFAULT 'RU',
    "explanation_mode" "ExplanationMode" NOT NULL DEFAULT 'STANDARD',
    "theme" "ThemeMode" NOT NULL DEFAULT 'SYSTEM',
    "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
    "text_scale" "TextScale" NOT NULL DEFAULT 'NORMAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dushanbe',
    "preferred_provider" TEXT,
    "save_history" BOOLEAN NOT NULL DEFAULT true,
    "source_preview_mode" "SourcePreviewMode" NOT NULL DEFAULT 'HISTORY',
    "default_reminder_offset_minutes" INTEGER,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "AnalysisStage" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER,
    "source_type" "SourceType" NOT NULL,
    "document_type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "output_language" "OutputLanguage" NOT NULL DEFAULT 'RU',
    "explanation_mode" "ExplanationMode" NOT NULL DEFAULT 'STANDARD',
    "retention_mode" "RetentionMode" NOT NULL DEFAULT 'HISTORY',
    "source_preview_mode" "SourcePreviewMode" NOT NULL DEFAULT 'HISTORY',
    "detected_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider" TEXT,
    "model" TEXT,
    "result_version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "overall_confidence" "ConfidenceLevel",
    "structured_result" JSONB,
    "user_edits" JSONB,
    "extracted_text_encrypted" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisInputMetadata" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "input_index" INTEGER NOT NULL,
    "original_type" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER,
    "sha256" TEXT NOT NULL,
    "temporary_provider_file_id" TEXT,
    "temporary_file_deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisInputMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisSourceAsset" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "client_page_id" TEXT NOT NULL,
    "input_index" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisSourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisVersion" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "change_source" "ChangeSource" NOT NULL,
    "ai_original" JSONB,
    "user_edited" JSONB,
    "structured_result" JSONB,
    "changed_fields" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarificationQuestion" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "field_path" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "suggested_answers" JSONB NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ClarificationStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClarificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT,
    "session_id" TEXT,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "simple_title" TEXT NOT NULL,
    "simple_description" TEXT,
    "assignee_text" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMP(3),
    "timezone" TEXT,
    "source_data" JSONB,
    "ai_original" JSONB,
    "client_mutation_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "idempotency_key" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "endpoint_encrypted" TEXT NOT NULL,
    "p256dh_encrypted" TEXT NOT NULL,
    "auth_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisShare" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalysisShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "analysis_id" TEXT,
    "session_id" TEXT,
    "user_id" TEXT,
    "storage_key" TEXT,
    "payload" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRun" (
    "id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" "AIRunOperation" NOT NULL,
    "status" "AIRunStatus" NOT NULL DEFAULT 'SUCCESS',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost" DECIMAL(12,6),
    "provider_request_id" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "params" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobQueueItem" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "dedup_key" TEXT,
    "payload" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "JobQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deleted_at_idx" ON "User"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousSession_token_hash_key" ON "AnonymousSession"("token_hash");

-- CreateIndex
CREATE INDEX "AnonymousSession_user_id_idx" ON "AnonymousSession"("user_id");

-- CreateIndex
CREATE INDEX "AnonymousSession_expires_at_idx" ON "AnonymousSession"("expires_at");

-- CreateIndex
CREATE INDEX "AnonymousSession_last_seen_at_idx" ON "AnonymousSession"("last_seen_at");

-- CreateIndex
CREATE INDEX "AnonymousSession_revoked_at_idx" ON "AnonymousSession"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_session_id_key" ON "UserPreferences"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_user_id_key" ON "UserPreferences"("user_id");

-- CreateIndex
CREATE INDEX "Analysis_session_id_deleted_at_created_at_idx" ON "Analysis"("session_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "Analysis_user_id_deleted_at_created_at_idx" ON "Analysis"("user_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "Analysis_status_updated_at_idx" ON "Analysis"("status", "updated_at");

-- CreateIndex
CREATE INDEX "Analysis_created_at_idx" ON "Analysis"("created_at");

-- CreateIndex
CREATE INDEX "Analysis_expires_at_idx" ON "Analysis"("expires_at");

-- CreateIndex
CREATE INDEX "Analysis_deleted_at_idx" ON "Analysis"("deleted_at");

-- CreateIndex
CREATE INDEX "AnalysisInputMetadata_sha256_idx" ON "AnalysisInputMetadata"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisInputMetadata_analysis_id_input_index_key" ON "AnalysisInputMetadata"("analysis_id", "input_index");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSourceAsset_storage_key_key" ON "AnalysisSourceAsset"("storage_key");

-- CreateIndex
CREATE INDEX "AnalysisSourceAsset_analysis_id_idx" ON "AnalysisSourceAsset"("analysis_id");

-- CreateIndex
CREATE INDEX "AnalysisSourceAsset_expires_at_idx" ON "AnalysisSourceAsset"("expires_at");

-- CreateIndex
CREATE INDEX "AnalysisVersion_analysis_id_idx" ON "AnalysisVersion"("analysis_id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisVersion_analysis_id_version_key" ON "AnalysisVersion"("analysis_id", "version");

-- CreateIndex
CREATE INDEX "ClarificationQuestion_analysis_id_status_idx" ON "ClarificationQuestion"("analysis_id", "status");

-- CreateIndex
CREATE INDEX "Task_session_id_deleted_at_updated_at_idx" ON "Task"("session_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "Task_user_id_deleted_at_updated_at_idx" ON "Task"("user_id", "deleted_at", "updated_at");

-- CreateIndex
CREATE INDEX "Task_analysis_id_deleted_at_idx" ON "Task"("analysis_id", "deleted_at");

-- CreateIndex
CREATE INDEX "Task_status_deleted_at_idx" ON "Task"("status", "deleted_at");

-- CreateIndex
CREATE INDEX "Task_deleted_at_idx" ON "Task"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_idempotency_key_key" ON "Reminder"("idempotency_key");

-- CreateIndex
CREATE INDEX "Reminder_status_scheduled_at_idx" ON "Reminder"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "Reminder_scheduled_at_idx" ON "Reminder"("scheduled_at");

-- CreateIndex
CREATE INDEX "Reminder_task_id_idx" ON "Reminder"("task_id");

-- CreateIndex
CREATE INDEX "PushSubscription_session_id_revoked_at_idx" ON "PushSubscription"("session_id", "revoked_at");

-- CreateIndex
CREATE INDEX "PushSubscription_user_id_revoked_at_idx" ON "PushSubscription"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisShare_token_hash_key" ON "AnalysisShare"("token_hash");

-- CreateIndex
CREATE INDEX "AnalysisShare_analysis_id_idx" ON "AnalysisShare"("analysis_id");

-- CreateIndex
CREATE INDEX "AnalysisShare_expires_at_idx" ON "AnalysisShare"("expires_at");

-- CreateIndex
CREATE INDEX "AnalysisShare_revoked_at_idx" ON "AnalysisShare"("revoked_at");

-- CreateIndex
CREATE INDEX "ExportJob_session_id_created_at_idx" ON "ExportJob"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "ExportJob_user_id_created_at_idx" ON "ExportJob"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- CreateIndex
CREATE INDEX "ExportJob_expires_at_idx" ON "ExportJob"("expires_at");

-- CreateIndex
CREATE INDEX "AIRun_analysis_id_created_at_idx" ON "AIRun"("analysis_id", "created_at");

-- CreateIndex
CREATE INDEX "AIRun_provider_created_at_idx" ON "AIRun"("provider", "created_at");

-- CreateIndex
CREATE INDEX "AIRun_status_created_at_idx" ON "AIRun"("status", "created_at");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expires_at_idx" ON "IdempotencyRecord"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actor_key_idempotency_key_key" ON "IdempotencyRecord"("actor_key", "idempotency_key");

-- CreateIndex
CREATE INDEX "AuditEvent_entity_type_entity_id_created_at_idx" ON "AuditEvent"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_type_actor_id_created_at_idx" ON "AuditEvent"("actor_type", "actor_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditEvent_created_at_idx" ON "AuditEvent"("created_at");

-- CreateIndex
CREATE INDEX "JobQueueItem_queue_status_available_at_idx" ON "JobQueueItem"("queue", "status", "available_at");

-- CreateIndex
CREATE INDEX "JobQueueItem_status_available_at_idx" ON "JobQueueItem"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "JobQueueItem_queue_dedup_key_key" ON "JobQueueItem"("queue", "dedup_key");

-- AddForeignKey
ALTER TABLE "AnonymousSession" ADD CONSTRAINT "AnonymousSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AnonymousSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AnonymousSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisInputMetadata" ADD CONSTRAINT "AnalysisInputMetadata_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSourceAsset" ADD CONSTRAINT "AnalysisSourceAsset_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisVersion" ADD CONSTRAINT "AnalysisVersion_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationQuestion" ADD CONSTRAINT "ClarificationQuestion_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AnonymousSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AnonymousSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisShare" ADD CONSTRAINT "AnalysisShare_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AnonymousSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRun" ADD CONSTRAINT "AIRun_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================== SQL-only: CHECK-ограничения ==============================

-- Owner isolation: ровно один владелец (session_id XOR user_id)
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_owner_check" CHECK (("session_id" IS NOT NULL) OR ("user_id" IS NOT NULL));
ALTER TABLE "Task" ADD CONSTRAINT "Task_owner_check" CHECK (("session_id" IS NOT NULL) OR ("user_id" IS NOT NULL));
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_owner_check" CHECK (("session_id" IS NOT NULL) OR ("user_id" IS NOT NULL));
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_owner_check" CHECK (("session_id" IS NOT NULL) OR ("user_id" IS NOT NULL));
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_owner_check" CHECK (("session_id" IS NOT NULL) OR ("user_id" IS NOT NULL));

-- Revision >= 1
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "Task" ADD CONSTRAINT "Task_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_revision_check" CHECK ("revision" >= 1);

-- Progress 0..100 или NULL; result_version >= 1
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_progress_check" CHECK ("progress" IS NULL OR ("progress" >= 0 AND "progress" <= 100));
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_result_version_check" CHECK ("result_version" >= 1);

-- AnalysisInputMetadata
ALTER TABLE "AnalysisInputMetadata" ADD CONSTRAINT "AnalysisInputMetadata_size_check" CHECK ("size_bytes" >= 0);
ALTER TABLE "AnalysisInputMetadata" ADD CONSTRAINT "AnalysisInputMetadata_index_check" CHECK ("input_index" >= 0);
ALTER TABLE "AnalysisInputMetadata" ADD CONSTRAINT "AnalysisInputMetadata_pages_check" CHECK ("page_count" IS NULL OR "page_count" <= 10);

-- AnalysisVersion / AnalysisShare
ALTER TABLE "AnalysisVersion" ADD CONSTRAINT "AnalysisVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "AnalysisShare" ADD CONSTRAINT "AnalysisShare_view_count_check" CHECK ("view_count" >= 0);

-- ============================== SQL-only: partial-индексы ==============================

-- Дедупликация offline-мутаций в области владельца (clientMutationId)
CREATE UNIQUE INDEX "Task_client_mutation_session_idx" ON "Task" ("client_mutation_id", "session_id") WHERE "client_mutation_id" IS NOT NULL AND "session_id" IS NOT NULL;
CREATE UNIQUE INDEX "Task_client_mutation_user_idx" ON "Task" ("client_mutation_id", "user_id") WHERE "client_mutation_id" IS NOT NULL AND "user_id" IS NOT NULL;

-- Поллер напоминаний видит только scheduled
CREATE INDEX "Reminder_scheduled_partial_idx" ON "Reminder" ("scheduled_at") WHERE "status" = 'SCHEDULED';
