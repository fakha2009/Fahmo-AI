-- CreateTable
CREATE TABLE "AnalysisEvent" (
    "id" SERIAL NOT NULL,
    "analysis_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stage" "AnalysisStage" NOT NULL,
    "progress" INTEGER NOT NULL,
    "message_key" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisEvent_analysis_id_id_idx" ON "AnalysisEvent"("analysis_id", "id");

-- CreateIndex
CREATE INDEX "AnalysisEvent_created_at_idx" ON "AnalysisEvent"("created_at");

-- AddForeignKey
ALTER TABLE "AnalysisEvent" ADD CONSTRAINT "AnalysisEvent_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
