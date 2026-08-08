import { z } from "zod";
import { ConfidenceLevelSchema } from "../common";
import { SourceReferenceSchema } from "./source-reference";
import { amountConfidenceRule } from "./confidence";

export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/).nullable();

export const ExtractedAmountSchema = z
  .object({
    rawText: z.string().min(1).max(500),
    value: z.string().regex(/^-?\d+(\.\d+)?$/).nullable(),
    currency: CurrencySchema,
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!amountConfidenceRule(value.value, value.confidence)) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "неоднозначная (null) сумма не может иметь confidence=high",
      });
    }
  });

export type ExtractedAmount = z.infer<typeof ExtractedAmountSchema>;
