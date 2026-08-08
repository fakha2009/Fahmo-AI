import { z } from "zod";

const GeminiPartSchema = z.object({ text: z.string() }).passthrough();

const GeminiCandidateSchema = z
  .object({
    content: z
      .object({
        parts: z.array(GeminiPartSchema).optional().default([]),
      })
      .passthrough(),
  })
  .passthrough();

const GeminiUsageMetadataSchema = z
  .object({
    promptTokenCount: z.number().int().nonnegative().optional(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const GeminiResponseSchema = z
  .object({
    candidates: z.array(GeminiCandidateSchema).optional().default([]),
    usageMetadata: GeminiUsageMetadataSchema.optional(),
  })
  .passthrough();

export type GeminiResponse = z.infer<typeof GeminiResponseSchema>;
