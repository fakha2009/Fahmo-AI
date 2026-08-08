import { z } from "zod";
import { MessageKeySchema, ParamsSchema, RequestIdSchema } from "../common";

export const ErrorCodeSchema = z.enum([
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "TOO_MANY_FILES",
  "PDF_PAGE_LIMIT_EXCEEDED",
  "PDF_PASSWORD_PROTECTED",
  "CORRUPTED_FILE",
  "TEXT_TOO_LONG",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "SESSION_EXPIRED",
  "NOT_FOUND",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_TIMEOUT",
  "AI_INVALID_RESPONSE",
  "AI_UNSUPPORTED_MODALITY",
  "ANALYSIS_NOT_READY",
  "ANALYSIS_CANCELLED",
  "CLARIFICATION_REQUIRED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "REMINDER_TIME_IN_PAST",
  "PUSH_PERMISSION_REQUIRED",
  "SHARE_REVOKED",
  "SHARE_EXPIRED",
  "EXPORT_NOT_READY",
  "EXPORT_GENERATION_FAILED",
  "RESOURCE_LIMIT_EXCEEDED",
  "INVALID_JOB_PAYLOAD",
]);

export const ErrorBodySchema = z
  .object({
    code: ErrorCodeSchema,
    messageKey: MessageKeySchema,
    params: ParamsSchema,
    message: z.string().min(1).max(500),
    requestId: RequestIdSchema,
    retryable: z.boolean(),
    details: z.unknown().nullable().default(null),
  })
  .strict();

export const ErrorResponseSchema = z
  .object({
    error: ErrorBodySchema,
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
