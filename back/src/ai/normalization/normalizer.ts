import { AppError } from "../../shared/errors";
import {
  AnalysisResultSchema,
  type AnalysisResult,
} from "../../validation/ai/analysis-result";
import type { OutputLanguage } from "../../validation/common";
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
    const parsed = withNullableSourceDefaults(this.parseContent(raw.content));
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
    const parsed = withNullableSourceDefaults(this.parseContent(raw.content));
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
