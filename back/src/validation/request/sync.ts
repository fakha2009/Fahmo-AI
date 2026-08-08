import { z } from "zod";
import { IsoDateTimeSchema } from "../common";
import { CursorSchema, LimitSchema } from "./pagination";

/**
 * GET /sync?updatedAfter=...&cursor=...&limit=...
 * updatedAfter и cursor взаимоисключающие: cursor продолжает предыдущую
 * страницу, updatedAfter — полная синхронизация (offline sync).
 */
export const SyncQuerySchema = z
  .object({
    updatedAfter: IsoDateTimeSchema.optional(),
    cursor: CursorSchema.optional(),
    limit: LimitSchema,
  })
  .strict()
  .refine((value) => value.updatedAfter !== undefined || value.cursor !== undefined, {
    message: "required one of: updatedAfter, cursor",
  });

export type SyncQuery = z.infer<typeof SyncQuerySchema>;
