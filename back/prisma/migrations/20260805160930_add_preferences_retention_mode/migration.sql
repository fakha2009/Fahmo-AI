-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN     "retention_mode" "RetentionMode" NOT NULL DEFAULT 'HISTORY';
