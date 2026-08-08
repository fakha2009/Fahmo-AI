import { z } from "zod";
import { IdSchema } from "../common";

export const BoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict();

export const SourceReferenceSchema = z
  .object({
    clientPageId: z.string().min(1).max(100),
    sourceAssetId: IdSchema.nullable(),
    inputIndex: z.number().int().min(0),
    pageNumber: z.number().int().min(1).nullable(),
    excerpt: z.string().max(2000).nullable(),
    boundingBox: BoundingBoxSchema.nullable(),
  })
  .strict();

export type SourceReference = z.infer<typeof SourceReferenceSchema>;
