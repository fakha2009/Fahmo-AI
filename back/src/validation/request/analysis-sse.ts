import { z } from "zod";

export const AnalysisSseQuerySchema = z
  .object({
    lastEventId: z.coerce.number().int().positive().optional(),
  })
  .strict();

export type AnalysisSseQuery = z.infer<typeof AnalysisSseQuerySchema>;
