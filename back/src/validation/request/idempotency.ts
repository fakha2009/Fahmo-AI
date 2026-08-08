import { z } from "zod";
import { IsoDateTimeSchema } from "../common";

export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export const ClientMutationIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export const IdempotencyRecordSchema = z
  .object({
    actorKey: z.string().min(1).max(256),
    idempotencyKey: IdempotencyKeySchema,
    endpoint: z.string().min(1).max(200),
    requestHash: z.string().min(1).max(64).nullable(),
    responseStatus: z.number().int().min(100).max(599),
    responseBody: z.unknown(),
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
export type ClientMutationId = z.infer<typeof ClientMutationIdSchema>;
