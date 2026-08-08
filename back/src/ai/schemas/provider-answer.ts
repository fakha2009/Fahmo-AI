import { z } from "zod";
import { ConfidenceLevelSchema, DocumentTypeSchema } from "../../validation/common";
import {
  AnalysisWarningSchema,
  ClarificationQuestionDraftSchema,
  ExtractedAmountSchema,
  ExtractedContactSchema,
  ExtractedDateSchema,
  ExtractedLinkSchema,
  ExtractedLocationSchema,
  ExtractedTaskSchema,
  RequiredDocumentSchema,
} from "../../validation/ai";

export const ProviderDocumentAnswerSchema = z
  .object({
    title: z.string().min(1).max(500),
    documentType: DocumentTypeSchema,
    detectedLanguages: z
      .array(z.string().regex(/^[a-z]{2,3}$/))
      .max(10)
      .optional(),
    summary: z.string().min(1).max(8000),
    simpleExplanation: z.string().min(1).max(8000),
    tasks: z.array(ExtractedTaskSchema).max(100).optional().default([]),
    dates: z.array(ExtractedDateSchema).max(200).optional().default([]),
    amounts: z.array(ExtractedAmountSchema).max(100).optional().default([]),
    locations: z.array(ExtractedLocationSchema).max(100).optional().default([]),
    contacts: z.array(ExtractedContactSchema).max(100).optional().default([]),
    requiredDocuments: z.array(RequiredDocumentSchema).max(100).optional().default([]),
    links: z.array(ExtractedLinkSchema).max(100).optional().default([]),
    warnings: z.array(AnalysisWarningSchema).max(100).optional().default([]),
    clarificationQuestions: z.array(ClarificationQuestionDraftSchema).max(50).optional().default([]),
    overallConfidence: ConfidenceLevelSchema,
  })
  .passthrough();

export type ProviderDocumentAnswer = z.infer<typeof ProviderDocumentAnswerSchema>;

export const ProviderSimplifyAnswerSchema = z
  .object({
    summary: z.string().min(1).max(8000),
    simpleExplanation: z.string().min(1).max(8000),
  })
  .passthrough();

export type ProviderSimplifyAnswer = z.infer<typeof ProviderSimplifyAnswerSchema>;

export const ProviderClarificationAnswerSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    documentType: DocumentTypeSchema.optional(),
    summary: z.string().min(1).max(8000).optional(),
    simpleExplanation: z.string().min(1).max(8000).optional(),
    tasks: z.array(ExtractedTaskSchema).max(100).optional(),
    dates: z.array(ExtractedDateSchema).max(200).optional(),
    amounts: z.array(ExtractedAmountSchema).max(100).optional(),
    locations: z.array(ExtractedLocationSchema).max(100).optional(),
    contacts: z.array(ExtractedContactSchema).max(100).optional(),
    requiredDocuments: z.array(RequiredDocumentSchema).max(100).optional(),
    links: z.array(ExtractedLinkSchema).max(100).optional(),
    warnings: z.array(AnalysisWarningSchema).max(100).optional(),
    clarificationQuestions: z.array(ClarificationQuestionDraftSchema).max(50).optional(),
    overallConfidence: ConfidenceLevelSchema.optional(),
  })
  .strict()
  .refine((answer) => Object.keys(answer).length > 0, {
    message: "Пустой ответ уточнения",
  });

export type ProviderClarificationAnswer = z.infer<typeof ProviderClarificationAnswerSchema>;
