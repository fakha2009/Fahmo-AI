import { z } from "zod";
import { ConfidenceLevelSchema, IsoDateSchema, IsoDateTimeSchema, TimezoneSchema } from "../common";
import { SourceReferenceSchema } from "./source-reference";
import { dateConfidenceRule } from "./confidence";

export const DateKindSchema = z.enum([
  "deadline",
  "event_start",
  "event_end",
  "reminder",
  "other",
]);

export const ExtractedDateSchema = z
  .object({
    rawText: z.string().min(1).max(500),
    isoDate: IsoDateSchema.nullable(),
    isoDateTime: IsoDateTimeSchema.nullable(),
    timezone: TimezoneSchema.nullable(),
    kind: DateKindSchema,
    isApproximate: z.boolean(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !dateConfidenceRule(
        value.isoDate,
        value.isoDateTime,
        value.isApproximate,
        value.confidence
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence"],
        message:
          "неоднозначная (null) или приблизительная дата не может иметь confidence=high",
      });
    }
  });

export type ExtractedDate = z.infer<typeof ExtractedDateSchema>;
