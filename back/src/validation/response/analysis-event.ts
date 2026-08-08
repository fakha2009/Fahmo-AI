import { z } from "zod";

export const AnalysisEventTypeSchema = z.enum([
  "analysis_created",
  "stage_updated",
  "clarification_required",
  "completed",
  "failed",
  "cancelled",
]);

export const AnalysisEventSchema = z
  .object({
    id: z.number().int().positive(),
    analysisId: z.string().min(1).max(64),
    type: AnalysisEventTypeSchema,
    stage: z.enum([
      "queued",
      "validating",
      "preparing_files",
      "extracting_content",
      "detecting_document_type",
      "analyzing",
      "checking_result",
      "normalizing",
      "saving",
      "completed",
    ]),
    progress: z.number().int().min(0).max(100),
    messageKey: z.string().min(1).max(200),
    payload: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.union([z.iso.datetime(), z.date()]),
  })
  .strict();

export type AnalysisEventResponse = z.infer<typeof AnalysisEventSchema>;
