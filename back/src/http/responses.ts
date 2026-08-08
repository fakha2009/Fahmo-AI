import type { ServerResponse } from "node:http";
import { AppError, toAppError } from "../shared/errors";
import type { ErrorResponse } from "../validation/response/error";
import type { RequestContext } from "./request-context";

export interface ResponseInput {
  res: ServerResponse;
  rc: RequestContext;
}

function setSessionTokenHeader(res: ServerResponse, sessionToken: string | null): void {
  if (sessionToken !== null && sessionToken.length > 0) {
    res.setHeader("X-Session-Token", sessionToken);
  }
}

export function sendJson(input: ResponseInput & { status?: number; body: unknown }): void {
  const body = JSON.stringify(input.body);
  input.res.statusCode = input.status ?? 200;
  input.res.setHeader("Content-Type", "application/json; charset=utf-8");
  input.res.setHeader("Content-Length", Buffer.byteLength(body));
  setSessionTokenHeader(input.res, input.rc.sessionToken);
  input.res.end(body);
}

export function sendNoContent(input: ResponseInput): void {
  input.res.statusCode = 204;
  setSessionTokenHeader(input.res, input.rc.sessionToken);
  input.res.end();
}

export function sendErrorResponse(input: ResponseInput & { error: unknown }): void {
  const appError = toAppError(input.error);
  const status = statusFor(appError);
  if (appError.code === "INTERNAL_ERROR") {
    console.error(
      `[${input.rc.requestId}] INTERNAL_ERROR:`,
      appError.cause instanceof Error ? appError.cause.stack ?? appError.cause.message : appError.cause
    );
  } else {
    console.warn(`[http:error] ${JSON.stringify({
      requestId: input.rc.requestId,
      status,
      code: appError.code,
      messageKey: appError.messageKey,
    })}`);
  }
  const body: ErrorResponse = {
    error: {
      code: appError.code,
      messageKey: appError.messageKey,
      params: appError.params,
      message: appError.message,
      requestId: input.rc.requestId,
      retryable: appError.retryable,
      details: appError.details ?? null,
    },
  };
  sendJson({ ...input, status, body });
}

export function statusFor(error: AppError): number {
  switch (error.code) {
    case "UNAUTHORIZED":
    case "SESSION_EXPIRED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
    case "SHARE_REVOKED":
    case "SHARE_EXPIRED":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "IDEMPOTENCY_CONFLICT":
    case "VERSION_CONFLICT":
    case "VALIDATION_ERROR":
    case "UNSUPPORTED_FILE_TYPE":
    case "FILE_TOO_LARGE":
    case "TOO_MANY_FILES":
    case "PDF_PAGE_LIMIT_EXCEEDED":
    case "PDF_PASSWORD_PROTECTED":
    case "CORRUPTED_FILE":
    case "TEXT_TOO_LONG":
    case "REMINDER_TIME_IN_PAST":
    case "INVALID_JOB_PAYLOAD":
      return 400;
    case "EXPORT_NOT_READY":
    case "ANALYSIS_NOT_READY":
    case "CLARIFICATION_REQUIRED":
      return 409;
    case "AI_PROVIDER_UNAVAILABLE":
    case "AI_PROVIDER_TIMEOUT":
    case "AI_INVALID_RESPONSE":
    case "AI_UNSUPPORTED_MODALITY":
    case "EXPORT_GENERATION_FAILED":
    case "PUSH_PERMISSION_REQUIRED":
    case "RESOURCE_LIMIT_EXCEEDED":
      return 502;
    default:
      return 500;
  }
}
