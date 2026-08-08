import { z } from "zod";
import {
  AnalysisStageSchema,
  AnalysisStatusSchema,
  IdSchema,
  IsoDateTimeSchema,
  MessageKeySchema,
} from "../common";
import { AnalysisResultSchema } from "../ai/analysis-result";

export const AnalysisStatusResponseSchema = z
  .object({
    analysisId: IdSchema,
    status: AnalysisStatusSchema,
    stage: AnalysisStageSchema,
    progress: z.number().int().min(0).max(100).nullable(),
    messageKey: MessageKeySchema,
    updatedAt: IsoDateTimeSchema,
    result: AnalysisResultSchema.optional(),
  })
  .strict();

export type AnalysisStatusResponse = z.infer<typeof AnalysisStatusResponseSchema>;
