import { AppError } from "../../shared/errors";
import {
  AnalysisResultSchema,
  type AnalysisResult,
} from "../../validation/ai/analysis-result";
import {
  IsoDateSchema,
  IsoDateTimeSchema,
  TimezoneSchema,
  type OutputLanguage,
} from "../../validation/common";
import {
  ProviderClarificationAnswerSchema,
  ProviderDocumentAnswerSchema,
  ProviderSimplifyAnswerSchema,
} from "../schemas/provider-answer";
import type { ProviderRawResult } from "../gateway/provider";

export const RESULT_VERSION = "1.0.0";

export class AiResponseNormalizer {
  parseContent(content: string): unknown {
    let candidate = content.trim();
    const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenced !== null && fenced[1] !== undefined) {
      candidate = fenced[1].trim();
    }
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      throw new AppError({
        code: "AI_INVALID_RESPONSE",
        message: "Невалидный JSON в ответе AI",
        cause: error,
      });
    }
  }

  normalizeDocument(raw: ProviderRawResult, language: OutputLanguage): AnalysisResult {
    const parsed = withRecoverableDateDefaults(
      withNullableSourceDefaults(this.parseContent(raw.content))
    );
    const answer = ProviderDocumentAnswerSchema.safeParse(parsed);
    if (!answer.success) {
      throw this.schemaError(answer.error);
    }
    return this.validateResult({
      version: RESULT_VERSION,
      outputLanguage: language,
      detectedLanguages: answer.data.detectedLanguages ?? [language],
      title: answer.data.title,
      documentType: answer.data.documentType,
      summary: answer.data.summary,
      simpleExplanation: answer.data.simpleExplanation,
      tasks: answer.data.tasks,
      dates: answer.data.dates,
      amounts: answer.data.amounts,
      locations: answer.data.locations,
      contacts: answer.data.contacts,
      requiredDocuments: answer.data.requiredDocuments,
      links: answer.data.links,
      warnings: answer.data.warnings,
      clarificationQuestions: answer.data.clarificationQuestions,
      overallConfidence: answer.data.overallConfidence,
    });
  }

  normalizeSimplify(
    raw: ProviderRawResult,
    previous: AnalysisResult,
    language: OutputLanguage
  ): AnalysisResult {
    const parsed = this.parseContent(raw.content);
    const answer = ProviderSimplifyAnswerSchema.safeParse(parsed);
    if (!answer.success) {
      throw this.schemaError(answer.error);
    }
    return this.validateResult({
      ...previous,
      outputLanguage: language,
      summary: answer.data.summary,
      simpleExplanation: answer.data.simpleExplanation,
    });
  }

  normalizeClarification(
    raw: ProviderRawResult,
    previous: AnalysisResult,
    language: OutputLanguage
  ): AnalysisResult {
    const parsed = withRecoverableDateDefaults(
      withNullableSourceDefaults(this.parseContent(raw.content))
    );
    const answer = ProviderClarificationAnswerSchema.safeParse(parsed);
    if (!answer.success) {
      throw this.schemaError(answer.error);
    }
    return this.validateResult({
      ...previous,
      outputLanguage: language,
      ...answer.data,
    });
  }

  private validateResult(value: unknown): AnalysisResult {
    const result = AnalysisResultSchema.safeParse(value);
    if (!result.success) {
      throw this.schemaError(result.error);
    }
    return result.data;
  }

  private schemaError(error: { flatten: () => unknown }): AppError {
    return new AppError({
      code: "AI_INVALID_RESPONSE",
      message: "Ответ AI не соответствует контракту результата",
      details: error.flatten(),
    });
  }
}

function withNullableSourceDefaults(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  for (const field of ["tasks", "dates", "amounts", "locations", "contacts", "requiredDocuments", "links", "warnings"] as const) {
    const items = value[field];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      normalizeSourceRefs(item);
      if (field === "tasks" && isRecord(item.deadline)) {
        normalizeSourceRefs(item.deadline);
      }
    }
  }
  return value;
}

/**
 * A malformed optional date must not discard an otherwise useful analysis.
 * Preserve valid RFC 3339 offsets, repair harmless formatting differences and
 * degrade uncertain values to a date-only/low-confidence extraction.
 */
function withRecoverableDateDefaults(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const dates = value.dates;
  if (Array.isArray(dates)) {
    for (const date of dates) {
      if (isRecord(date)) normalizeDate(date);
    }
  }
  const tasks = value.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (isRecord(task) && isRecord(task.deadline)) normalizeDate(task.deadline);
    }
  }
  return value;
}

function normalizeDate(date: Record<string, unknown>): void {
  const originalDateTime = nullableTrimmedString(date.isoDateTime);
  const normalizedDateTime = normalizeIsoDateTime(originalDateTime);
  const normalizedDate = normalizeIsoDate(date.isoDate)
    ?? normalizeIsoDate(originalDateTime?.slice(0, 10));

  date.isoDate = normalizedDate;
  date.isoDateTime = normalizedDateTime;
  date.timezone = normalizeTimezone(date.timezone);
  if (normalizedDate === null && normalizedDateTime === null) {
    date.isApproximate = true;
    if (date.confidence === "high") date.confidence = "medium";
  }
}

function normalizeIsoDate(value: unknown): string | null {
  const candidate = nullableTrimmedString(value);
  if (candidate === null) return null;
  return IsoDateSchema.safeParse(candidate).success ? candidate : null;
}

function normalizeIsoDateTime(value: string | null): string | null {
  if (value === null) return null;
  let candidate = value.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/u,
    "$1T$2"
  );
  candidate = candidate.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
  return IsoDateTimeSchema.safeParse(candidate).success ? candidate : null;
}

function normalizeTimezone(value: unknown): string | null {
  const candidate = nullableTrimmedString(value);
  if (candidate === null) return null;
  return TimezoneSchema.safeParse(candidate).success ? candidate : null;
}

function nullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate === "" ? null : candidate;
}

function normalizeSourceRefs(owner: Record<string, unknown>): void {
  if (!Array.isArray(owner.sourceRefs)) {
    return;
  }
  owner.sourceRefs = owner.sourceRefs.map((sourceRef) => {
    if (!isRecord(sourceRef)) {
      return sourceRef;
    }
    return {
      sourceAssetId: null,
      boundingBox: null,
      ...sourceRef,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
