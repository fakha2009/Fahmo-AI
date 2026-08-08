import { z } from "zod";
import { CursorSchema } from "../request/pagination";

export function PageSchema<Item extends z.ZodType>(itemSchema: Item) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: CursorSchema.nullable(),
      total: z.number().int().min(0).optional(),
    })
    .strict();
}

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
};
