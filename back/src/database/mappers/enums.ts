import type {
  AiOperation,
} from "../../ai/gateway/provider";
import type {
  AIRunOperation as PrismaAirRunOperation,
  AIRunStatus as PrismaAirRunStatus,
  AnalysisStage as PrismaAnalysisStage,
  AnalysisStatus as PrismaAnalysisStatus,
  ClarificationStatus as PrismaClarificationStatus,
  ConfidenceLevel as PrismaConfidenceLevel,
  DocumentType as PrismaDocumentType,
  ExplanationMode as PrismaExplanationMode,
  ExportKind as PrismaExportKind,
  JobStatus as PrismaJobStatus,
  OutputLanguage as PrismaOutputLanguage,
  ReminderChannel as PrismaReminderChannel,
  ReminderStatus as PrismaReminderStatus,
  RetentionMode as PrismaRetentionMode,
  SourcePreviewMode as PrismaSourcePreviewMode,
  SourceType as PrismaSourceType,
  TaskPriority as PrismaTaskPriority,
  TaskStatus as PrismaTaskStatus,
  TextScale as PrismaTextScale,
  ThemeMode as PrismaThemeMode,
} from "@prisma/client";
import type {
  AnalysisStage,
  AnalysisStatus,
  ClarificationStatus,
  ConfidenceLevel,
  DocumentType,
  ExplanationMode,
  ExportKind,
  ExportJobStatus,
  OutputLanguage,
  ReminderChannel,
  ReminderStatus,
  RetentionMode,
  SourcePreviewMode,
  SourceType,
  TaskPriority,
  TaskStatus,
  TextScale,
  ThemeMode,
} from "../../validation/common";

// Доменные значения — lowercase (Zod), в БД — UPPERCASE (Prisma enum).
// Отображение задаётся один раз через таблицу domain → prisma.

interface EnumPair<D extends string, P extends string> {
  fromPrisma: (value: P) => D;
  toPrisma: (value: D) => P;
}

function enumPair<D extends string, P extends string>(domainToPrisma: Record<D, P>): EnumPair<D, P> {
  const prismaToDomain = Object.fromEntries(
    Object.entries(domainToPrisma).map(([domain, prisma]) => [prisma, domain])
  ) as Record<P, D>;
  return {
    fromPrisma: (value: P): D => prismaToDomain[value],
    toPrisma: (value: D): P => domainToPrisma[value],
  };
}

export const analysisStatus = enumPair<AnalysisStatus, PrismaAnalysisStatus>({
  queued: "QUEUED",
  validating: "VALIDATING",
  processing: "PROCESSING",
  needs_clarification: "NEEDS_CLARIFICATION",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED",
});

export const analysisStage = enumPair<AnalysisStage, PrismaAnalysisStage>({
  queued: "QUEUED",
  validating: "VALIDATING",
  preparing_files: "PREPARING_FILES",
  extracting_content: "EXTRACTING_CONTENT",
  detecting_document_type: "DETECTING_DOCUMENT_TYPE",
  analyzing: "ANALYZING",
  checking_result: "CHECKING_RESULT",
  normalizing: "NORMALIZING",
  saving: "SAVING",
  completed: "COMPLETED",
});

export const documentType = enumPair<DocumentType, PrismaDocumentType>({
  announcement: "ANNOUNCEMENT",
  work_assignment: "WORK_ASSIGNMENT",
  handwritten_note: "HANDWRITTEN_NOTE",
  contract: "CONTRACT",
  invoice: "INVOICE",
  certificate: "CERTIFICATE",
  identity: "IDENTITY",
  statement: "STATEMENT",
  letter: "LETTER",
  notice: "NOTICE",
  receipt: "RECEIPT",
  other: "OTHER",
});

export const outputLanguage = enumPair<OutputLanguage, PrismaOutputLanguage>({
  ru: "RU",
  tg: "TG",
  en: "EN",
});

export const confidenceLevel = enumPair<ConfidenceLevel, PrismaConfidenceLevel>({
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
});

export const sourceType = enumPair<SourceType, PrismaSourceType>({
  text: "TEXT",
  image: "IMAGE",
  pdf: "PDF",
  multi_image: "MULTI_IMAGE",
});

export const explanationMode = enumPair<ExplanationMode, PrismaExplanationMode>({
  standard: "STANDARD",
  simple: "SIMPLE",
});

export const retentionMode = enumPair<RetentionMode, PrismaRetentionMode>({
  history: "HISTORY",
  temporary: "TEMPORARY",
});

export const sourcePreviewMode = enumPair<SourcePreviewMode, PrismaSourcePreviewMode>({
  history: "HISTORY",
  temporary: "TEMPORARY",
  no_preview: "NO_PREVIEW",
});

export const clarificationStatus = enumPair<ClarificationStatus, PrismaClarificationStatus>({
  open: "OPEN",
  answered: "ANSWERED",
  cancelled: "CANCELLED",
});

// "started" — маркер начала вызова; в БД фиксируется только финальный статус.
export const airRunFinalStatus = enumPair<"success" | "failed", PrismaAirRunStatus>({
  success: "SUCCESS",
  failed: "FAILED",
});

export const airRunOperation = enumPair<AiOperation, PrismaAirRunOperation>({
  analyze_document: "ANALYZE_DOCUMENT",
  analyze_text: "ANALYZE_TEXT",
  answer_clarification: "ANSWER_CLARIFICATION",
  simplify_result: "SIMPLIFY_RESULT",
});

export const taskPriority = enumPair<TaskPriority, PrismaTaskPriority>({
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
});

export const taskStatus = enumPair<TaskStatus, PrismaTaskStatus>({
  pending: "PENDING",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
});

export const reminderChannel = enumPair<ReminderChannel, PrismaReminderChannel>({
  in_app: "IN_APP",
  web_push: "WEB_PUSH",
  calendar: "CALENDAR",
});

export const reminderStatus = enumPair<ReminderStatus, PrismaReminderStatus>({
  scheduled: "SCHEDULED",
  sent: "SENT",
  cancelled: "CANCELLED",
  failed: "FAILED",
});

export const themeMode = enumPair<ThemeMode, PrismaThemeMode>({
  system: "SYSTEM",
  light: "LIGHT",
  dark: "DARK",
});

export const textScale = enumPair<TextScale, PrismaTextScale>({
  normal: "NORMAL",
  large: "LARGE",
});

export const exportKind = enumPair<ExportKind, PrismaExportKind>({
  pdf: "PDF",
  ics: "ICS",
  data: "DATA",
});

export const exportJobStatus = enumPair<ExportJobStatus, PrismaJobStatus>({
  queued: "QUEUED",
  running: "RUNNING",
  done: "DONE",
  failed: "FAILED",
});
