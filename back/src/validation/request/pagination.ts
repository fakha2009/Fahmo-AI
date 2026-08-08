import { z } from "zod";

export const CursorSchema = z.string().min(1).max(512);

export const LimitSchema = z.number().int().min(1).max(50).default(20);

export const SortSchema = z
  .enum([
    "created_at_desc",
    "created_at_asc",
    "updated_at_desc",
    "updated_at_asc",
  ])
  .default("created_at_desc");

export const PaginationQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: LimitSchema,
    sort: SortSchema,
  })
  .strict();

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
