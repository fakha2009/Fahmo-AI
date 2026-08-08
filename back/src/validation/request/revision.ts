import { z } from "zod";
import { MessageKeySchema, RequestIdSchema } from "../common";

export const RevisionNumberSchema = z.number().int().min(1);

export const ExpectedRevisionSchema = RevisionNumberSchema;

export const IfMatchHeaderSchema = z
  .string()
  .regex(/^revision-\d+$/)
  .transform((value) => Number(value.slice("revision-".length)));

export const VersionConflictErrorSchema = z
  .object({
    error: z
      .object({
        code: z.literal("VERSION_CONFLICT"),
        messageKey: MessageKeySchema,
        params: z
          .object({
            serverRevision: RevisionNumberSchema,
          })
          .strict(),
        message: z.string().min(1).max(500),
        requestId: RequestIdSchema,
        retryable: z.literal(false),
        details: z.unknown().nullable().default(null),
      })
      .strict(),
  })
  .strict();

export type RevisionNumber = z.infer<typeof RevisionNumberSchema>;
