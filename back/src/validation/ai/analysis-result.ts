import { z } from "zod";
import {
  ConfidenceLevelSchema,
  DocumentTypeSchema,
  OutputLanguageSchema,
} from "../common";
import { SourceReferenceSchema } from "./source-reference";
import { ExtractedTaskSchema } from "./extracted-task";
import { ExtractedDateSchema } from "./extracted-date";
import { ExtractedAmountSchema } from "./extracted-amount";
import { AnalysisWarningSchema } from "./analysis-warning";
import { ClarificationQuestionDraftSchema } from "./clarification-question";

export const ExtractedLocationSchema = z
  .object({
    rawText: z.string().min(1).max(500),
    name: z.string().max(500).nullable(),
    address: z.string().max(1000).nullable(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict();

export const ExtractedContactTypeSchema = z.enum(["phone", "email", "link", "other"]);

export const ExtractedContactSchema = z
  .object({
    rawText: z.string().min(1).max(500),
    type: ExtractedContactTypeSchema,
    value: z.string().max(500).nullable(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict();

export const RequiredDocumentSchema = z
  .object({
    name: z.string().min(1).max(500),
    description: z.string().max(2000).nullable(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict();

export const ExtractedLinkSchema = z
  .object({
    rawText: z.string().min(1).max(1000),
    url: z.url().nullable(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
  })
  .strict();

export const AnalysisResultSchema = z
  .object({
    version: z.string().regex(/^[0-9]+\.[0-9]+(\.[0-9]+)?$/),
    title: z.string().min(1).max(500),
    documentType: DocumentTypeSchema,
    detectedLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)),
    outputLanguage: OutputLanguageSchema,
    summary: z.string().min(1).max(8000),
    simpleExplanation: z.string().min(1).max(8000),
    tasks: z.array(ExtractedTaskSchema).max(100),
    dates: z.array(ExtractedDateSchema).max(200),
    amounts: z.array(ExtractedAmountSchema).max(100),
    locations: z.array(ExtractedLocationSchema).max(100),
    contacts: z.array(ExtractedContactSchema).max(100),
    requiredDocuments: z.array(RequiredDocumentSchema).max(100),
    links: z.array(ExtractedLinkSchema).max(100),
    warnings: z.array(AnalysisWarningSchema).max(100),
    clarificationQuestions: z.array(ClarificationQuestionDraftSchema).max(50),
    overallConfidence: ConfidenceLevelSchema,
  })
  .strict();

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
