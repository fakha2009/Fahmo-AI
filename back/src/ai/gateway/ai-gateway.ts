import { AppError, isAppError } from "../../shared/errors";
import type { AnalysisResult } from "../../validation/ai/analysis-result";
import { AiResponseNormalizer } from "../normalization/normalizer";
import { backoffDelay, sleep, totalBytesOfPages, withTimeout } from "./call-policy";
import { NoopAirRunLogger, type AirRunLogger } from "./airun-logger";
import type { ProviderConfig } from "./provider";
import type { AIProvider, AiOperation, ProviderRawResult } from "./provider";
import { ProviderRegistry } from "./provider-registry";
import { ProviderRouter, type RouteRequest } from "./provider-router";
import type {
  AnalyzeDocumentInput,
  AnalyzeTextInput,
  AnswerClarificationInput,
  SimplifyResultInput,
} from "./provider";

export interface AiGatewayOptions {
  registry: ProviderRegistry;
  router: ProviderRouter;
  normalizer: AiResponseNormalizer;
  logger?: AirRunLogger;
}

const MAX_BACKOFF_MS = 4_000;

export class AiGateway {
  private readonly logger: AirRunLogger;

  constructor(private readonly options: AiGatewayOptions) {
    this.logger = options.logger ?? new NoopAirRunLogger();
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalysisResult> {
    return this.execute(
      {
        operation: "analyze_document",
        inputType: input.inputType,
        language: input.language,
        pageCount: input.pages.length,
        inputBytes: totalBytesOfPages(input.pages),
        preferLowLatency: input.preferLowLatency ?? false,
        preferLowCost: input.preferLowCost ?? false,
        preferredProvider: input.preferredProvider ?? undefined,
      },
      input.analysisId,
      (provider, signal) => provider.analyzeDocument({ ...input, signal }),
      (raw) => this.options.normalizer.normalizeDocument(raw, input.language)
    );
  }

  async analyzeText(input: AnalyzeTextInput): Promise<AnalysisResult> {
    return this.execute(
      {
        operation: "analyze_text",
        inputType: "text",
        language: input.language,
        pageCount: 1,
        inputBytes: Buffer.byteLength(input.text, "utf8"),
        preferLowLatency: input.preferLowLatency ?? false,
        preferLowCost: input.preferLowCost ?? false,
        preferredProvider: input.preferredProvider ?? undefined,
      },
      input.analysisId,
      (provider, signal) => provider.analyzeText({ ...input, signal }),
      (raw) => this.options.normalizer.normalizeDocument(raw, input.language)
    );
  }

  async answerClarification(
    input: AnswerClarificationInput,
    previous: AnalysisResult
  ): Promise<AnalysisResult> {
    return this.execute(
      {
        operation: "answer_clarification",
        inputType: "text",
        language: input.language,
        pageCount: 1,
        inputBytes: Buffer.byteLength(input.answer, "utf8") + JSON.stringify(previous).length,
        preferLowLatency: input.preferLowLatency ?? false,
        preferLowCost: input.preferLowCost ?? false,
        preferredProvider: input.preferredProvider ?? undefined,
      },
      input.analysisId,
      (provider, signal) => provider.answerClarification({ ...input, signal }),
      (raw) => this.options.normalizer.normalizeClarification(raw, previous, input.language)
    );
  }

  async simplifyResult(
    input: SimplifyResultInput,
    previous: AnalysisResult
  ): Promise<AnalysisResult> {
    return this.execute(
      {
        operation: "simplify_result",
        inputType: "text",
        language: input.language,
        pageCount: 1,
        inputBytes: JSON.stringify(previous).length,
        preferLowLatency: input.preferLowLatency ?? false,
        preferLowCost: input.preferLowCost ?? false,
        preferredProvider: input.preferredProvider ?? undefined,
      },
      input.analysisId,
      (provider, signal) => provider.simplifyResult({ ...input, signal }),
      (raw) => this.options.normalizer.normalizeSimplify(raw, previous, input.language)
    );
  }

  private async execute(
    routeRequest: RouteRequest,
    analysisId: string | null,
    call: (provider: AIProvider, signal: AbortSignal) => Promise<ProviderRawResult>,
    normalize: (raw: ProviderRawResult) => AnalysisResult
  ): Promise<AnalysisResult> {
    const candidates = this.options.router.route(routeRequest);
    if (candidates.length === 0) {
      throw new AppError({
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "Нет доступного AI-провайдера для данного запроса",
        params: {
          operation: routeRequest.operation,
          inputType: routeRequest.inputType,
          language: routeRequest.language,
        },
      });
    }
    const failures: unknown[] = [];
    for (const provider of candidates) {
      const config = this.options.registry.getConfig(provider.name);
      const maxRetries = Math.max(1, config?.maxRetries ?? 1);
      const timeoutMs = config?.timeoutMs ?? 60_000;
      const baseDelayMs = config?.retryBaseDelayMs ?? 250;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const startedAt = new Date();
        await this.recordStarted(analysisId, attempt, provider, config, routeRequest.operation, startedAt);
        try {
          const raw = await withTimeout((signal) => call(provider, signal), timeoutMs);
          const result = await normalize(raw);
          await this.recordResult(analysisId, attempt, provider, config, routeRequest.operation, startedAt, raw, null);
          return result;
        } catch (error) {
          const appError = isAppError(error) ? error : new AppError({ code: "AI_PROVIDER_UNAVAILABLE", cause: error });
          console.warn("[ai] provider attempt failed", JSON.stringify({
            analysisId,
            provider: provider.name,
            operation: routeRequest.operation,
            attempt,
            code: appError.code,
            params: appError.params,
            details: appError.details,
          }));
          await this.recordResult(analysisId, attempt, provider, config, routeRequest.operation, startedAt, null, appError);
          failures.push(error);
          const retryable = appError.retryable;
          if (retryable && attempt < maxRetries) {
            await sleep(backoffDelay(baseDelayMs, attempt, MAX_BACKOFF_MS));
            continue;
          }
          break;
        }
      }
    }
    throw new AppError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "Все AI-провайдеры недоступны",
      details: failures,
    });
  }

  private async recordStarted(
    analysisId: string | null,
    attempt: number,
    provider: AIProvider,
    config: ProviderConfig | null,
    operation: AiOperation,
    startedAt: Date
  ): Promise<void> {
    await this.logger.record({
      analysisId,
      attempt,
      provider: provider.name,
      model: config?.model ?? "unknown",
      operation,
      status: "started",
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCost: null,
      providerRequestId: null,
      errorCode: null,
      startedAt,
      finishedAt: null,
    });
  }

  private async recordResult(
    analysisId: string | null,
    attempt: number,
    provider: AIProvider,
    config: ProviderConfig | null,
    operation: AiOperation,
    startedAt: Date,
    raw: ProviderRawResult | null,
    error: AppError | null
  ): Promise<void> {
    const finishedAt = new Date();
    const latencyMs = raw?.latencyMs ?? Date.now() - startedAt.getTime();
    this.options.registry.recordResult(provider.name, latencyMs, error === null);
    await this.logger.record({
      analysisId,
      attempt,
      provider: provider.name,
      model: raw?.model ?? config?.model ?? "unknown",
      operation,
      status: error === null ? "success" : "failed",
      latencyMs,
      inputTokens: raw?.inputTokens ?? null,
      outputTokens: raw?.outputTokens ?? null,
      estimatedCost:
        raw !== null && config !== null
          ? (raw.inputTokens * config.costPerMillionInput + raw.outputTokens * config.costPerMillionOutput) / 1_000_000
          : null,
      providerRequestId: raw?.providerRequestId ?? null,
      errorCode: error?.code ?? null,
      startedAt,
      finishedAt,
    });
  }
}
