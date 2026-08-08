import type { EnvConfig } from "../config";
import type { OutputLanguage } from "../validation/common";
import { DeepSeekProvider } from "./providers/deepseek/deepseek-provider";
import { GeminiProvider } from "./providers/gemini/gemini-provider";
import { AiGateway } from "./gateway/ai-gateway";
import { ProviderRegistry } from "./gateway/provider-registry";
import { ProviderRouter } from "./gateway/provider-router";
import { AiResponseNormalizer } from "./normalization/normalizer";
import type { ProviderConfig } from "./gateway/provider";
import type { AiInputType } from "./gateway/provider";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const SUPPORTED_LANGUAGES: OutputLanguage[] = ["ru", "tg", "en"];
const GEMINI_INPUTS: AiInputType[] = ["text", "image", "pdf"];

/**
 * Собирает ProviderConfig из EnvConfig. Провайдер считается включённым,
 * только если задан apiKey; пустой ключ → enabled: false (исключается
 * из маршрутизации, но остаётся в реестре для диагностики).
 */
export function buildProviderConfigs(config: EnvConfig): ProviderConfig[] {
  const gemini: ProviderConfig = {
    name: "gemini",
    apiKey: config.GEMINI_API_KEY ?? "",
    baseUrl: GEMINI_BASE_URL,
    model: config.GEMINI_MODEL ?? "gemini-flash-latest",
    enabled: (config.GEMINI_API_KEY ?? "").length > 0,
    priority: indexOf(config.AI_VISION_PROVIDER_ORDER, "gemini"),
    timeoutMs: 60_000,
    maxRetries: 2,
    retryBaseDelayMs: 1_000,
    costPerMillionInput: 0.10,
    costPerMillionOutput: 0.40,
    supportedInputs: GEMINI_INPUTS,
    supportedLanguages: SUPPORTED_LANGUAGES,
    maxInputPages: 10,
    maxInputBytes: 10 * 1024 * 1024,
    maxOutputChars: 100_000,
  };

  const deepseek: ProviderConfig = {
    name: "deepseek",
    apiKey: config.DEEPSEEK_API_KEY ?? "",
    baseUrl: DEEPSEEK_BASE_URL,
    model: config.DEEPSEEK_MODEL ?? "deepseek-chat",
    enabled: (config.DEEPSEEK_API_KEY ?? "").length > 0,
    priority: indexOf(config.AI_TEXT_PROVIDER_ORDER, "deepseek"),
    timeoutMs: 60_000,
    maxRetries: 2,
    retryBaseDelayMs: 1_000,
    costPerMillionInput: 0.27,
    costPerMillionOutput: 1.10,
    supportedInputs: ["text"],
    supportedLanguages: SUPPORTED_LANGUAGES,
    maxInputPages: 1,
    maxInputBytes: 500_000,
    maxOutputChars: 100_000,
  };

  return [gemini, deepseek];
}

function indexOf(order: readonly string[], name: string): number {
  const index = order.indexOf(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export interface AiStack {
  registry: ProviderRegistry;
  router: ProviderRouter;
  gateway: AiGateway;
}

/**
 * Composition root AI-слоя: реестр провайдеров из EnvConfig,
 * маршрутизация по приоритетам и готовый AiGateway.
 */
export function createAiStack(config: EnvConfig): AiStack {
  const registry = new ProviderRegistry();
  for (const providerConfig of buildProviderConfigs(config)) {
    const provider =
      providerConfig.name === "gemini"
        ? new GeminiProvider(providerConfig)
        : new DeepSeekProvider(providerConfig);
    registry.register(provider, providerConfig);
  }
  const router = new ProviderRouter(registry);
  const gateway = new AiGateway({
    registry,
    router,
    normalizer: new AiResponseNormalizer(),
  });
  return { registry, router, gateway };
}
