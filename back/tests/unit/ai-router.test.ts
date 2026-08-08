import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { OutputLanguage } from "../../src/validation/common";
import { ProviderRegistry } from "../../src/ai/gateway/provider-registry";
import { ProviderRouter } from "../../src/ai/gateway/provider-router";
import type {
  AIProvider,
  AiOperation,
  ProviderCapabilities,
  ProviderConfig,
  ProviderRawResult,
} from "../../src/ai/gateway/provider";

function config(name: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name,
    apiKey: "key",
    baseUrl: `https://${name}.example.com/v1`,
    model: `${name}-model`,
    enabled: true,
    priority: 100,
    timeoutMs: 1000,
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

class FakeProvider implements AIProvider {
  readonly name: string;
  constructor(
    name: string,
    private readonly capabilities: ProviderCapabilities
  ) {
    this.name = name;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async analyzeDocument(): Promise<ProviderRawResult> {
    return this.result("analyze_document");
  }

  async analyzeText(): Promise<ProviderRawResult> {
    return this.result("analyze_text");
  }

  async answerClarification(): Promise<ProviderRawResult> {
    return this.result("answer_clarification");
  }

  async simplifyResult(): Promise<ProviderRawResult> {
    return this.result("simplify_result");
  }

  private async result(operation: AiOperation): Promise<ProviderRawResult> {
    return {
      providerName: this.name,
      model: `${this.name}-model`,
      operation,
      content: "{}",
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      providerRequestId: null,
      finishedAt: new Date(),
    };
  }
}

function register(registry: ProviderRegistry, name: string, cfg: Partial<ProviderConfig>): void {
  const providerConfig = config(name, cfg);
  registry.register(new FakeProvider(name, {
    name,
    available: providerConfig.enabled && providerConfig.apiKey.length > 0,
    supportedInputs: providerConfig.supportedInputs,
    supportedLanguages: providerConfig.supportedLanguages,
    maxInputPages: providerConfig.maxInputPages,
    maxInputBytes: providerConfig.maxInputBytes,
    maxOutputChars: providerConfig.maxOutputChars,
  }), providerConfig);
}

function makeRouter(registry: ProviderRegistry): ProviderRouter {
  return new ProviderRouter(registry);
}

const baseRequest = {
  operation: "analyze_document" as const,
  inputType: "image" as const,
  language: "ru" as OutputLanguage,
  pageCount: 1,
  inputBytes: 1024,
  preferLowLatency: false,
  preferLowCost: false,
  preferredProvider: undefined,
};

test("ProviderRouter: фильтрует по поддерживаемому типу входа", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { supportedInputs: ["image", "pdf"] });
  register(registry, "deepseek", { supportedInputs: ["text"] });
  const route = makeRouter(registry).route({ ...baseRequest, inputType: "image" });
  assert.deepEqual(route.map((p) => p.name), ["gemini"]);
});

test("ProviderRouter: фильтрует по языку", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { supportedLanguages: ["ru", "en"] });
  register(registry, "deepseek", { supportedLanguages: ["ru", "tg", "en"] });
  const route = makeRouter(registry).route({ ...baseRequest, language: "tg" });
  assert.deepEqual(route.map((p) => p.name), ["deepseek"]);
});

test("ProviderRouter: фильтрует по количеству страниц и размеру", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { maxInputPages: 50, maxInputBytes: 20 * 1024 * 1024 });
  register(registry, "deepseek", { maxInputPages: 5, maxInputBytes: 1024 * 1024 });
  const router = makeRouter(registry);
  assert.deepEqual(router.route({ ...baseRequest, pageCount: 10 }).map((p) => p.name), ["gemini"]);
  assert.deepEqual(router.route({ ...baseRequest, inputBytes: 2 * 1024 * 1024 }).map((p) => p.name), ["gemini"]);
  assert.deepEqual(router.route({ ...baseRequest, pageCount: 3, inputBytes: 500 * 1024 }).map((p) => p.name), ["gemini", "deepseek"]);
});

test("ProviderRouter: исключает недоступных (disabled или пустой ключ)", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { enabled: false });
  register(registry, "deepseek", { apiKey: "" });
  assert.deepEqual(makeRouter(registry).route(baseRequest), []);
});

test("ProviderRouter: preferredProvider ставится первым", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { priority: 1 });
  register(registry, "deepseek", { priority: 2 });
  const route = makeRouter(registry).route({ ...baseRequest, preferredProvider: "deepseek" });
  assert.deepEqual(route.map((p) => p.name), ["deepseek", "gemini"]);
});

test("ProviderRouter: fallback order по priority при прочих равных", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { priority: 10 });
  register(registry, "deepseek", { priority: 1 });
  const route = makeRouter(registry).route(baseRequest);
  assert.deepEqual(route.map((p) => p.name), ["deepseek", "gemini"]);
});

test("ProviderRouter: учитывает отдельный приоритет для операции", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { priority: 0, operationPriorities: { analyze_text: 1 } });
  register(registry, "deepseek", { priority: 10, operationPriorities: { analyze_text: 0 } });
  const route = makeRouter(registry).route({
    ...baseRequest,
    operation: "analyze_text",
    inputType: "text",
  });
  assert.deepEqual(route.map((provider) => provider.name), ["deepseek", "gemini"]);
});

test("ProviderRouter: preferLowLatency сортирует по средней задержке", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { priority: 1 });
  register(registry, "deepseek", { priority: 2 });
  registry.recordResult("gemini", 2000, true);
  registry.recordResult("deepseek", 100, true);
  const route = makeRouter(registry).route({ ...baseRequest, preferLowLatency: true });
  assert.deepEqual(route.map((p) => p.name), ["deepseek", "gemini"]);
});

test("ProviderRouter: preferLowCost сортирует по цене", () => {
  const registry = new ProviderRegistry();
  register(registry, "gemini", { costPerMillionInput: 50, costPerMillionOutput: 150 });
  register(registry, "deepseek", { costPerMillionInput: 5, costPerMillionOutput: 10 });
  const route = makeRouter(registry).route({ ...baseRequest, preferLowCost: true });
  assert.deepEqual(route.map((p) => p.name), ["deepseek", "gemini"]);
});
