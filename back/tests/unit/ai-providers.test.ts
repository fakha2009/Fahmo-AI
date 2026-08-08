import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { GeminiProvider } from "../../src/ai/providers/gemini/gemini-provider";
import { DeepSeekProvider } from "../../src/ai/providers/deepseek/deepseek-provider";
import type { AIProvider, ProviderConfig } from "../../src/ai/gateway/provider";

function baseConfig(name: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name,
    apiKey: "test-key",
    baseUrl: `https://${name}.example.com/v1`,
    model: `${name}-model`,
    enabled: true,
    priority: 1,
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

type FetchCall = { url: string; init: RequestInit };
type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: FetchHandler): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return handler(call.url, call.init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validContent = JSON.stringify({
  title: "Договор",
  documentType: "contract",
  summary: "s",
  simpleExplanation: "e",
  overallConfidence: "high",
});

test("GeminiProvider: успешный вызов, парсинг usage и контента", async () => {
  const { fetchFn, calls } = fakeFetch(() =>
    jsonResponse({
      candidates: [{ content: { parts: [{ text: validContent }, { text: "" }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
    })
  );
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  const result = await provider.analyzeText({
    analysisId: null,
    language: "ru",
    text: "Текст документа",
  });
  assert.equal(result.providerName, "gemini");
  assert.equal(result.operation, "analyze_text");
  assert.equal(result.content, validContent);
  assert.equal(result.inputTokens, 120);
  assert.equal(result.outputTokens, 40);
  assert.ok(result.latencyMs >= 0);
  assert.ok(calls[0]?.url.includes(":generateContent"));
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
  const body = JSON.parse(String(calls[0]?.init.body)) as {
    generationConfig: { responseMimeType: string };
  };
  assert.equal(body.generationConfig.responseMimeType, "application/json");
});

test("GeminiProvider: изображения передаются как inlineData base64", async () => {
  const { fetchFn, calls } = fakeFetch(() =>
    jsonResponse({ candidates: [{ content: { parts: [{ text: validContent }] } }] })
  );
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  await provider.analyzeDocument({
    analysisId: null,
    language: "ru",
    inputType: "image",
    pages: [
      { index: 0, kind: "image", mimeType: "image/png", content: new Uint8Array([1, 2, 3]) },
      { index: 1, kind: "text", mimeType: null, content: "Страница текстом" },
    ],
  });
  const body = JSON.parse(String(calls[0]?.init.body)) as {
    contents: { parts: ({ text?: string } | { inlineData?: { mimeType: string; data: string } })[] }[];
  };
  const parts = body.contents[0]?.parts;
  assert.ok(Array.isArray(parts));
  assert.deepEqual(
    (parts?.[1] as { inlineData: { mimeType: string; data: string } }).inlineData,
    { mimeType: "image/png", data: Buffer.from([1, 2, 3]).toString("base64") }
  );
  assert.equal((parts?.[2] as { text: string }).text, "Страница текстом");
});

test("GeminiProvider: 429 → RATE_LIMITED (retryable)", async () => {
  const { fetchFn } = fakeFetch(() => jsonResponse({ error: { message: "quota" } }, 429));
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "RATE_LIMITED" && error.retryable === true
  );
});

test("GeminiProvider: 500 → AI_PROVIDER_UNAVAILABLE (retryable)", async () => {
  const { fetchFn } = fakeFetch(() => jsonResponse({}, 500));
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "AI_PROVIDER_UNAVAILABLE" && error.retryable === true
  );
});

test("GeminiProvider: 400 → AI_PROVIDER_UNAVAILABLE (не retryable)", async () => {
  const { fetchFn } = fakeFetch(() => jsonResponse({ error: { message: "bad" } }, 400));
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "AI_PROVIDER_UNAVAILABLE" && error.retryable === false
  );
});

test("GeminiProvider: abort сигнала → AI_PROVIDER_TIMEOUT (retryable)", async () => {
  const { fetchFn } = fakeFetch((_url, init) => {
    const controller = new AbortController();
    const signal = init.signal;
    if (signal instanceof AbortSignal) {
      signal.addEventListener("abort", () => controller.abort());
    }
    return new Promise<Response>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  });
  const provider = new GeminiProvider(baseConfig("gemini"), fetchFn);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x", signal: controller.signal }),
    (error: unknown) =>
      error instanceof AppError && error.code === "AI_PROVIDER_TIMEOUT" && error.retryable === true
  );
});

test("DeepSeekProvider: успешный вызов, usage и providerRequestId", async () => {
  const { fetchFn, calls } = fakeFetch(() =>
    jsonResponse({
      id: "chatcmpl-123",
      choices: [{ message: { content: validContent } }],
      usage: { prompt_tokens: 200, completion_tokens: 60 },
    })
  );
  const provider = new DeepSeekProvider(baseConfig("deepseek"), fetchFn);
  const result = await provider.analyzeText({ analysisId: null, language: "ru", text: "Текст" });
  assert.equal(result.providerName, "deepseek");
  assert.equal(result.content, validContent);
  assert.equal(result.inputTokens, 200);
  assert.equal(result.outputTokens, 60);
  assert.equal(result.providerRequestId, "chatcmpl-123");
  assert.equal(calls[0]?.url, "https://deepseek.example.com/v1/chat/completions");
  assert.equal((calls[0]?.init.headers as Record<string, string>)["Authorization"], "Bearer test-key");
  const body = JSON.parse(String(calls[0]?.init.body)) as { response_format: { type: string } };
  assert.equal(body.response_format.type, "json_object");
});

test("DeepSeekProvider: 429 → RATE_LIMITED (retryable)", async () => {
  const { fetchFn } = fakeFetch(() => jsonResponse({ error: { message: "rate" } }, 429));
  const provider = new DeepSeekProvider(baseConfig("deepseek"), fetchFn);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "RATE_LIMITED" && error.retryable === true
  );
});

test("DeepSeekProvider: сетевая ошибка → AI_PROVIDER_UNAVAILABLE (retryable)", async () => {
  const { fetchFn } = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  const provider = new DeepSeekProvider(baseConfig("deepseek"), fetchFn);
  await assert.rejects(
    provider.analyzeText({ analysisId: null, language: "ru", text: "x" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "AI_PROVIDER_UNAVAILABLE" && error.retryable === true
  );
});

test("Контракт: оба провайдера реализуют единый AIProvider и capabilities", () => {
  const providers: { provider: AIProvider; config: ProviderConfig }[] = [
    { provider: new GeminiProvider(baseConfig("gemini")), config: baseConfig("gemini") },
    { provider: new DeepSeekProvider(baseConfig("deepseek")), config: baseConfig("deepseek") },
  ];
  for (const { provider, config: cfg } of providers) {
    assert.equal(provider.name, cfg.name);
    const capabilities = provider.getCapabilities();
    assert.equal(capabilities.name, cfg.name);
    assert.equal(capabilities.available, true);
    assert.ok(capabilities.supportedInputs.length > 0);
    assert.ok(capabilities.supportedLanguages.length > 0);
    assert.equal(capabilities.maxInputPages, cfg.maxInputPages);
    assert.equal(capabilities.maxInputBytes, cfg.maxInputBytes);
    for (const method of [
      "analyzeDocument",
      "analyzeText",
      "answerClarification",
      "simplifyResult",
    ] as const) {
      assert.equal(typeof provider[method], "function", `${cfg.name}.${method} отсутствует`);
    }
  }
});
