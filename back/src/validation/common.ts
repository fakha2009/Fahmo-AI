import { z } from "zod";

export const IdSchema = z.string().min(20).max(40).regex(/^[a-z0-9]+$/, "cuid-подобный id");
/** Analyses use UUIDs; legacy/imported records may still use the compact resource id. */
export const AnalysisIdSchema = z.union([z.uuid(), IdSchema]);
export const OpaqueTokenSchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._-]+$/);

export const IsoDateTimeSchema = z.iso.datetime();
export const IsoDateSchema = z.iso.date();
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      return Intl.supportedValuesOf("timeZone").includes(value);
    } catch {
      return false;
    }
  }, "IANA timezone");
export const RequestIdSchema = z.uuid();
export const MessageKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^errors\.[a-zA-Z0-9_.]+$/);
export const ParamsSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

export const OutputLanguageSchema = z.enum(["ru", "tg", "en"]);
export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export const DocumentTypeSchema = z.enum([
  "announcement",
  "work_assignment",
  "handwritten_note",
  "contract",
  "invoice",
  "certificate",
  "identity",
  "statement",
  "letter",
  "notice",
  "receipt",
  "other",
]);
export const SourceTypeSchema = z.enum(["text", "image", "pdf", "multi_image"]);
export const ExplanationModeSchema = z.enum(["standard", "simple"]);
export const RetentionModeSchema = z.enum(["history", "temporary"]);
export const SourcePreviewModeSchema = z.enum(["history", "temporary", "no_preview"]);
export const ThemeModeSchema = z.enum(["system", "light", "dark"]);
export const TextScaleSchema = z.enum(["normal", "large"]);
export const TaskPrioritySchema = z.enum(["high", "medium", "low"]);
export const TaskStatusSchema = z.enum(["pending", "completed", "cancelled"]);
export const ReminderChannelSchema = z.enum(["in_app", "web_push", "calendar"]);
export const ReminderStatusSchema = z.enum(["scheduled", "sent", "cancelled", "failed"]);
export const ClarificationStatusSchema = z.enum(["open", "answered", "cancelled"]);
export const ExportKindSchema = z.enum(["pdf", "ics", "data"]);
export const ExportJobStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export const ChangeSourceSchema = z.enum(["ai", "user", "clarification", "reanalyze"]);
export const AnalysisStatusSchema = z.enum([
  "queued",
  "validating",
  "processing",
  "needs_clarification",
  "completed",
  "failed",
  "cancelled",
]);
export const AnalysisStageSchema = z.enum([
  "queued",
  "validating",
  "preparing_files",
  "extracting_content",
  "detecting_document_type",
  "analyzing",
  "checking_result",
  "normalizing",
  "saving",
  "completed",
]);

export type OutputLanguage = z.infer<typeof OutputLanguageSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;
export type AnalysisStage = z.infer<typeof AnalysisStageSchema>;
export type SourcePreviewMode = z.infer<typeof SourcePreviewModeSchema>;
export type RetentionMode = z.infer<typeof RetentionModeSchema>;
export type ExplanationMode = z.infer<typeof ExplanationModeSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type TextScale = z.infer<typeof TextScaleSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;
export type ClarificationStatus = z.infer<typeof ClarificationStatusSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type ExportKind = z.infer<typeof ExportKindSchema>;
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;
