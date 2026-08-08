import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import type { AnalysisResult } from "../../src/validation/ai/analysis-result";
import { AiGateway } from "../../src/ai/gateway/ai-gateway";
import { ProviderRegistry } from "../../src/ai/gateway/provider-registry";
import { ProviderRouter } from "../../src/ai/gateway/provider-router";
import { AiResponseNormalizer } from "../../src/ai/normalization/normalizer";
import type { AirRunAttempt } from "../../src/ai/gateway/airun-logger";
import type {
  AIProvider,
  AiOperation,
  AnalyzeDocumentInput,
  ProviderCapabilities,
  ProviderConfig,
  ProviderRawResult,
} from "../../src/ai/gateway/provider";

const validDocumentContent = JSON.stringify({
  title: "Договор аренды",
  documentType: "contract",
  summary: "Резюме договора аренды",
  simpleExplanation: "Простое объяснение",
  overallConfidence: "high",
});

function previousResult(): AnalysisResult {
  return {
    version: "1.0.0",
    title: "Договор",
    documentType: "contract",
    detectedLanguages: ["ru"],
    outputLanguage: "ru",
    summary: "Резюме",
    simpleExplanation: "Объяснение",
    tasks: [],
    dates: [],
    amounts: [],
    locations: [],
    contacts: [],
    requiredDocuments: [],
    links: [],
    warnings: [],
    clarificationQuestions: [],
    overallConfidence: "high",
  };
}

function config(name: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name,
    apiKey: "key",
    baseUrl: `https://${name}.example.com/v1`,
    model: `${name}-model`,
    enabled: true,
    priority: 100,
    timeoutMs: 60_000,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    costPerMillionInput: 10,
    costPerMillionOutput: 30,
    supportedInputs: ["image", "pdf", "text"],
    supportedLanguages: ["ru", "tg", "en"],
    maxInputPages: 50,
    maxInputBytes: 20 * 1024 * 1024,
    maxOutputChars: 20000,
    ...overrides,
  };
}

type Behavior = (signal?: AbortSignal) => Promise<ProviderRawResult>;

class FakeProvider implements AIProvider {
  readonly name: string;
  readonly calls: AiOperation[] = [];
  private readonly behaviors: Record<AiOperation, Behavior>;

  constructor(
    name: string,
    behaviors: Partial<Record<AiOperation, Behavior>>,
    private readonly capabilities: ProviderCapabilities
  ) {
    this.name = name;
    this.behaviors = {
      analyze_document: (signal) => this.ok("analyze_document", signal),
      analyze_text: (signal) => this.ok("analyze_text", signal),
      answer_clarification: async (signal) => this.raw("answer_clarification", JSON.stringify({ summary: "Обновлённое резюме" }), signal),
      simplify_result: async (signal) =>
        this.raw("simplify_result", JSON.stringify({ summary: "Простое резюме", simpleExplanation: "Простое объяснение" }), signal),
      ...behaviors,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<ProviderRawResult> {
    this.calls.push("analyze_document");
    return this.behaviors.analyze_document(input.signal);
  }

  async analyzeText(input: { signal?: AbortSignal }): Promise<ProviderRawResult> {
    this.calls.push("analyze_text");
    return this.behaviors.analyze_text(input.signal);
  }

  async answerClarification(input: { signal?: AbortSignal }): Promise<ProviderRawResult> {
    this.calls.push("answer_clarification");
    return this.behaviors.answer_clarification(input.signal);
  }

  async simplifyResult(input: { signal?: AbortSignal }): Promise<ProviderRawResult> {
    this.calls.push("simplify_result");
    return this.behaviors.simplify_result(input.signal);
  }

  private async ok(operation: AiOperation, _signal?: AbortSignal): Promise<ProviderRawResult> {
    return this.raw(operation, validDocumentContent);
  }

  private raw(operation: AiOperation, content: string, _signal?: AbortSignal): ProviderRawResult {
    return {
      providerName: this.name,
      model: `${this.name}-model`,
      operation,
      content,
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 10,
      providerRequestId: null,
      finishedAt: new Date(),
    };
  }
}

function register(registry: ProviderRegistry, provider: FakeProvider, cfg: Partial<ProviderConfig>): void {
  const providerConfig = config(provider.name, cfg);
  registry.register(provider, {
    ...providerConfig,
    supportedInputs: cfg.supportedInputs ?? providerConfig.supportedInputs,
  });
}

function retryable(providerName: string, times: number): Behavior {
  return async (_signal?: AbortSignal) => {
    if (times > 0) {
      times -= 1;
      throw new AppError({
        code: "AI_PROVIDER_UNAVAILABLE",
        message: `${providerName} временно недоступен`,
        retryable: true,
      });
    }
    return {
      providerName,
      model: `${providerName}-model`,
      operation: "analyze_document",
      content: validDocumentContent,
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      providerRequestId: null,
      finishedAt: new Date(),
    };
  };
}

class MemoryAirRunLogger {
  readonly attempts: AirRunAttempt[] = [];
  async record(attempt: AirRunAttempt): Promise<void> {
    this.attempts.push(attempt);
  }
}

function buildGateway(providers: { provider: FakeProvider; config: Partial<ProviderConfig> }[]) {
  const registry = new ProviderRegistry();
  for (const { provider, config: cfg } of providers) {
    register(registry, provider, cfg);
  }
  const router = new ProviderRouter(registry);
  const logger = new MemoryAirRunLogger();
  const gateway = new AiGateway({
    registry,
    router,
    normalizer: new AiResponseNormalizer(),
    logger,
  });
  return { gateway, registry, logger };
}

function documentInput(overrides: Partial<AnalyzeDocumentInput> = {}): AnalyzeDocumentInput {
  return {
    analysisId: "analysis-1",
    language: "ru",
    inputType: "image",
    pages: [{ index: 0, kind: "image", mimeType: "image/jpeg", content: new Uint8Array(16) }],
    ...overrides,
  };
}

const unavailableBehavior = (_signal?: AbortSignal): Promise<ProviderRawResult> =>
  Promise.reject(
    new AppError({ code: "AI_PROVIDER_UNAVAILABLE", message: "недоступен", retryable: true })
  );

test("AiGateway: успешный анализ через primary, результат нормализован", async () => {
  const primary = new FakeProvider("gemini", {}, available(true));
  const { gateway } = buildGateway([{ provider: primary, config: {} }]);
  const result = await gateway.analyzeDocument(documentInput());
  assert.equal(result.title, "Договор аренды");
  assert.equal(result.outputLanguage, "ru");
  assert.equal(result.detectedLanguages[0], "ru");
  assert.deepEqual(primary.calls, ["analyze_document"]);
});

test("AiGateway: retry только для retryable-ошибок, затем успех", async () => {
  const primary = new FakeProvider("gemini", {
    analyze_document: retryable("gemini", 2),
  }, available(true));
  const { gateway } = buildGateway([{ provider: primary, config: { maxRetries: 3 } }]);
  const result = await gateway.analyzeDocument(documentInput());
  assert.equal(result.title, "Договор аренды");
  assert.equal(primary.calls.length, 3);
});

test("AiGateway: non-retryable ошибка не ретраится, fallback на следующий провайдер", async () => {
  const primary = new FakeProvider("gemini", {
    analyze_document: () =>
      Promise.reject(new AppError({ code: "AI_INVALID_RESPONSE", message: "плохой ответ" })),
  }, available(true));
  const fallback = new FakeProvider("deepseek", {}, available(true));
  const { gateway } = buildGateway([
    { provider: primary, config: { priority: 1, maxRetries: 3 } },
    { provider: fallback, config: { priority: 2 } },
  ]);
  const result = await gateway.analyzeDocument(documentInput());
  assert.equal(primary.calls.length, 1);
  assert.equal(result.title, "Договор аренды");
});

test("AiGateway: невалидный JSON от primary → fallback", async () => {
  const primary = new FakeProvider("gemini", {
    analyze_document: () =>
      Promise.resolve({
        providerName: "gemini",
        model: "gemini-model",
        operation: "analyze_document",
        content: "не json",
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        providerRequestId: null,
        finishedAt: new Date(),
      }),
  }, available(true));
  const fallback = new FakeProvider("deepseek", {}, available(true));
  const { gateway } = buildGateway([
    { provider: primary, config: { priority: 1 } },
    { provider: fallback, config: { priority: 2 } },
  ]);
  const result = await gateway.analyzeDocument(documentInput());
  assert.equal(primary.calls.length, 1);
  assert.equal(result.title, "Договор аренды");
});

test("AiGateway: все провайдеры недоступны → AI_PROVIDER_UNAVAILABLE с details", async () => {
  const primary = new FakeProvider("gemini", { analyze_document: unavailableBehavior }, available(true));
  const fallback = new FakeProvider("deepseek", { analyze_document: unavailableBehavior }, available(true));
  const { gateway } = buildGateway([
    { provider: primary, config: { priority: 1, maxRetries: 2 } },
    { provider: fallback, config: { priority: 2, maxRetries: 2 } },
  ]);
  await assert.rejects(
    gateway.analyzeDocument(documentInput()),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "AI_PROVIDER_UNAVAILABLE" &&
      Array.isArray(error.details) &&
      error.details.length === 4
  );
});

test("AiGateway: нет подходящих кандидатов → AI_PROVIDER_UNAVAILABLE с params", async () => {
  const provider = new FakeProvider("gemini", {}, available(false));
  const { gateway } = buildGateway([{ provider, config: { enabled: false } }]);
  await assert.rejects(
    gateway.analyzeDocument(documentInput()),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "AI_PROVIDER_UNAVAILABLE" &&
      error.params.operation === "analyze_document"
  );
});

test("AiGateway: таймаут провайдера → retry → fallback", async () => {
  const hanging = (signal?: AbortSignal): Promise<ProviderRawResult> =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () =>
        reject(new AppError({ code: "AI_PROVIDER_TIMEOUT", retryable: true, message: "таймаут" }))
      );
    });
  const primary = new FakeProvider("gemini", { analyze_document: hanging }, available(true));
  const fallback = new FakeProvider("deepseek", {}, available(true));
  const { gateway } = buildGateway([
    { provider: primary, config: { priority: 1, timeoutMs: 30, maxRetries: 2 } },
    { provider: fallback, config: { priority: 2 } },
  ]);
  const result = await gateway.analyzeDocument(documentInput());
  assert.equal(result.title, "Договор аренды");
  assert.equal(primary.calls.length, 2);
});

test("AiGateway: AIRun логируются до вызова (started) и после (success/failed)", async () => {
  const primary = new FakeProvider("gemini", {
    analyze_document: unavailableBehavior,
  }, available(true));
  const { gateway, logger } = buildGateway([{ provider: primary, config: { maxRetries: 1 } }]);
  await assert.rejects(gateway.analyzeDocument(documentInput()));
  assert.equal(logger.attempts.length, 2);
  assert.equal(logger.attempts[0]?.status, "started");
  assert.equal(logger.attempts[0]?.provider, "gemini");
  assert.equal(logger.attempts[0]?.analysisId, "analysis-1");
  assert.equal(logger.attempts[1]?.status, "failed");
  assert.equal(logger.attempts[1]?.errorCode, "AI_PROVIDER_UNAVAILABLE");
  assert.ok((logger.attempts[1]?.latencyMs ?? -1) >= 0);
});

test("AiGateway: success фиксирует токены и стоимость", async () => {
  const primary = new FakeProvider("gemini", {}, available(true));
  const { gateway, logger } = buildGateway([
    { provider: primary, config: { costPerMillionInput: 10, costPerMillionOutput: 30 } },
  ]);
  await gateway.analyzeDocument(documentInput());
  const success = logger.attempts.find((a) => a.status === "success");
  assert.ok(success !== undefined);
  assert.equal(success.inputTokens, 100);
  assert.equal(success.outputTokens, 50);
  assert.equal(success.estimatedCost, (100 * 10 + 50 * 30) / 1_000_000);
  assert.equal(success.errorCode, null);
});

test("AiGateway: answerClarification и simplifyResult возвращают обновлённый результат", async () => {
  const provider = new FakeProvider("deepseek", {}, available(true));
  const { gateway } = buildGateway([{ provider, config: {} }]);
  const previous = previousResult();
  const clarifyResult = await gateway.answerClarification(
    {
      analysisId: "analysis-1",
      language: "ru",
      question: { fieldPath: "dates", question: "Какая дата окончания?", suggestedAnswers: [] },
      answer: "31 декабря 2026",
      previousResult: previous,
    },
    previous
  );
  assert.equal(clarifyResult.summary, "Обновлённое резюме");
  assert.equal(clarifyResult.title, "Договор");
  assert.equal(provider.calls[0], "answer_clarification");
  const simplified = await gateway.simplifyResult(
    {
      analysisId: "analysis-1",
      language: "ru",
      audience: "child",
      previousResult: previous,
    },
    previous
  );
  assert.equal(simplified.summary, "Простое резюме");
  assert.equal(simplified.simpleExplanation, "Простое объяснение");
  assert.equal(simplified.title, "Договор");
  assert.deepEqual(provider.calls, ["answer_clarification", "simplify_result"]);
});

function available(value: boolean): ProviderCapabilities {
  return {
    name: "x",
    available: value,
    supportedInputs: ["image", "pdf", "text"],
    supportedLanguages: ["ru", "tg", "en"],
    maxInputPages: 50,
    maxInputBytes: 20 * 1024 * 1024,
    maxOutputChars: 20000,
  };
}
