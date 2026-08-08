import { z } from "zod";
import { MessageKeySchema, ParamsSchema } from "../common";
import { SourceReferenceSchema } from "./source-reference";

export const AnalysisWarningCodeSchema = z.enum([
  "UNCLEAR_TEXT",
  "AMBIGUOUS_DATE",
  "AMBIGUOUS_AMOUNT",
  "CONFLICTING_INFORMATION",
  "MISSING_INFORMATION",
  "LOW_CONFIDENCE",
  "UNSUPPORTED_CONTENT",
]);

export const WarningSeveritySchema = z.enum(["info", "warning", "critical"]);

export const AnalysisWarningSchema = z
  .object({
    code: AnalysisWarningCodeSchema,
    messageKey: MessageKeySchema,
    params: ParamsSchema,
    severity: WarningSeveritySchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict();

export type AnalysisWarning = z.infer<typeof AnalysisWarningSchema>;
