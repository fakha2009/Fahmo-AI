import type { ErrorCode } from "../../validation/response/error";

export type ErrorParams = Record<string, string | number | boolean | null>;

export interface AppErrorInput {
  code: ErrorCode;
  message?: string;
  params?: ErrorParams;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

const FALLBACK_MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNSUPPORTED_FILE_TYPE: "Неподдерживаемый тип файла",
  FILE_TOO_LARGE: "Файл слишком большой",
  TOO_MANY_FILES: "Слишком много файлов",
  PDF_PAGE_LIMIT_EXCEEDED: "PDF содержит слишком много страниц",
  PDF_PASSWORD_PROTECTED: "PDF защищён паролем",
  CORRUPTED_FILE: "Файл повреждён",
  TEXT_TOO_LONG: "Текст слишком длинный",
  RATE_LIMITED: "Слишком много запросов",
  VALIDATION_ERROR: "Некорректные данные запроса",
  INTERNAL_ERROR: "Внутренняя ошибка сервера",
  UNAUTHORIZED: "Требуется авторизация",
  FORBIDDEN: "Доступ запрещён",
  SESSION_EXPIRED: "Сессия истекла",
  NOT_FOUND: "Объект не найден",
  AI_PROVIDER_UNAVAILABLE: "AI-провайдер недоступен",
  AI_PROVIDER_TIMEOUT: "AI-провайдер не ответил вовремя",
  AI_INVALID_RESPONSE: "Некорректный ответ AI",
  AI_UNSUPPORTED_MODALITY: "AI не поддерживает данный тип входа",
  ANALYSIS_NOT_READY: "Анализ ещё не готов",
  ANALYSIS_CANCELLED: "Анализ отменён",
  CLARIFICATION_REQUIRED: "Требуется уточнение",
  VERSION_CONFLICT: "Конфликт версий",
  IDEMPOTENCY_CONFLICT: "Конфликт идемпотентного ключа",
  REMINDER_TIME_IN_PAST: "Время напоминания в прошлом",
  PUSH_PERMISSION_REQUIRED: "Требуется разрешение push",
  SHARE_REVOKED: "Ссылка отозвана",
  SHARE_EXPIRED: "Срок действия ссылки истёк",
  EXPORT_NOT_READY: "Экспорт ещё не готов",
  EXPORT_GENERATION_FAILED: "Не удалось сформировать экспорт",
  RESOURCE_LIMIT_EXCEEDED: "Превышен лимит ресурсов",
  INVALID_JOB_PAYLOAD: "Некорректные данные задания",
};

export function messageKeyFor(code: ErrorCode): string {
  const segments = code.toLowerCase().split("_");
  const camel =
    segments[0] +
    segments
      .slice(1)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("");
  return `errors.${camel}`;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly params: ErrorParams;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(input: AppErrorInput) {
    super(input.message ?? FALLBACK_MESSAGES[input.code] ?? "Ошибка");
    this.name = "AppError";
    this.code = input.code;
    this.messageKey = messageKeyFor(input.code);
    this.params = input.params ?? {};
    this.retryable = input.retryable ?? false;
    this.details = input.details ?? null;
    if (input.cause !== undefined) {
      this.cause = input.cause;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError({ code: "INTERNAL_ERROR", cause: error });
}
