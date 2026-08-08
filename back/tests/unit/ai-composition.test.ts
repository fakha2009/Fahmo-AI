import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildProviderConfigs,
  createAiStack,
} from "../../src/ai/composition";
import type { EnvConfig } from "../../src/config";

function env(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/fahmo_ai",
    APP_URL: "http://localhost:3000",
    SESSION_SECRET: "session-secret-32-chars-long-xxxxxx",
    DATA_ENCRYPTION_KEY: "data-encryption-key-32-chars-xxxx",
    LOG_LEVEL: "info",
    AI_VISION_PROVIDER_ORDER: ["gemini"],
    AI_TEXT_PROVIDER_ORDER: ["deepseek", "gemini"],
    AI_CLARIFICATION_PROVIDER_ORDER: ["deepseek", "gemini"],
    AI_FALLBACK_ENABLED: true,
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_PDF_PAGES: 10,
    MAX_IMAGE_COUNT: 10,
    MAX_TEXT_LENGTH: 50000,
    ANONYMOUS_SESSION_TTL_DAYS: 30,
    ...overrides,
  } as EnvConfig;
}

test("buildProviderConfigs: без ключей оба провайдера отключены", () => {
  const configs = buildProviderConfigs(env());
  assert.equal(configs.length, 2);
  assert.equal(configs.find((c) => c.name === "gemini")?.enabled, false);
  assert.equal(configs.find((c) => c.name === "deepseek")?.enabled, false);
});

test("buildProviderConfigs: с ключом Gemini провайдер включён и приоритет из порядка", () => {
  const configs = buildProviderConfigs(
    env({
      GEMINI_API_KEY: "secret-gemini",
      GEMINI_MODEL: "gemini-flash-latest",
      DEEPSEEK_API_KEY: "secret-deepseek",
    })
  );
  const gemini = configs.find((c) => c.name === "gemini");
  const deepseek = configs.find((c) => c.name === "deepseek");
  assert.equal(gemini?.enabled, true);
  assert.equal(gemini?.model, "gemini-flash-latest");
  assert.equal(deepseek?.enabled, true);
  assert.equal(gemini?.priority, 0); // AI_VISION_PROVIDER_ORDER: ["gemini"] — первый
  assert.equal(deepseek?.priority, 0); // AI_TEXT_PROVIDER_ORDER: ["deepseek", "gemini"] — первый
});

test("createAiStack: registry содержит провайдеров, gateway готов", () => {
  const stack = createAiStack(env({ GEMINI_API_KEY: "secret-gemini" }));
  assert.deepEqual(
    stack.registry.list().map((provider) => provider.name).sort(),
    ["deepseek", "gemini"]
  );
  assert.equal(stack.registry.list().find((p) => p.name === "gemini")?.getCapabilities().available, true);
  assert.equal(typeof stack.gateway.analyzeText, "function");
});
