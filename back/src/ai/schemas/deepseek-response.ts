import { z } from "zod";

const DeepSeekMessageSchema = z.object({ content: z.string() }).passthrough();

const DeepSeekChoiceSchema = z
  .object({
    message: DeepSeekMessageSchema.optional(),
  })
  .passthrough();

const DeepSeekUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const DeepSeekResponseSchema = z
  .object({
    choices: z.array(DeepSeekChoiceSchema).optional().default([]),
    usage: DeepSeekUsageSchema.optional(),
    id: z.string().optional(),
  })
  .passthrough();

export type DeepSeekResponse = z.infer<typeof DeepSeekResponseSchema>;
