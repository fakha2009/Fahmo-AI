import { z } from "zod";
import { ClarificationStatusSchema, IsoDateTimeSchema } from "../common";

export const ClarificationQuestionDraftSchema = z
  .object({
    fieldPath: z.string().min(1).max(200),
    question: z.string().min(1).max(500),
    suggestedAnswers: z.array(z.string().min(1).max(500)).max(20),
    required: z.boolean(),
  })
  .strict();

export type ClarificationQuestionDraft = z.infer<typeof ClarificationQuestionDraftSchema>;

export const ClarificationQuestionSchema = z
  .object({
    id: z.string().min(1).max(64),
    fieldPath: z.string().min(1).max(200),
    question: z.string().min(1).max(500),
    suggestedAnswers: z.array(z.string().min(1).max(500)).max(20),
    required: z.boolean(),
    status: ClarificationStatusSchema,
    answer: z.string().max(1000).nullable(),
    answeredAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;
