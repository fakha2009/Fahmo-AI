import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseEnv, loadConfig } from "../../src/config";
import { EnvSchema } from "../../src/config/schema";

function validEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/fahmo_ai",
    APP_URL: "http://localhost:3000",
    SESSION_SECRET: "session-secret-32-chars-long-xxxxxx",
    DATA_ENCRYPTION_KEY: "data-encryption-key-32-chars-xxxx",
    LOG_LEVEL: "info",
  };
}

test("Config: валидное окружение парсится", () => {
  const config = parseEnv(validEnv());
  assert.equal(config.NODE_ENV, "test");
  assert.equal(config.APP_URL, "http://localhost:3000");
  assert.equal(config.LOG_LEVEL, "info");
  assert.equal(config.MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
  assert.equal(config.MAX_PDF_PAGES, 10);
  assert.equal(config.ANONYMOUS_SESSION_TTL_DAYS, 30);
});

test("Config: применяются значения по умолчанию", () => {
  const config = parseEnv(validEnv());
  assert.deepEqual(config.AI_VISION_PROVIDER_ORDER, ["gemini"]);
  assert.deepEqual(config.AI_TEXT_PROVIDER_ORDER, ["deepseek", "gemini"]);
  assert.deepEqual(config.AI_CLARIFICATION_PROVIDER_ORDER, ["deepseek", "gemini"]);
  assert.equal(config.AI_FALLBACK_ENABLED, true);
  assert.equal(config.GEMINI_API_KEY, undefined);
  assert.equal(config.DEEPSEEK_MODEL, undefined);
});

test("Config: CSV-порядок провайдеров и bool парсятся", () => {
  const config = parseEnv({
    ...validEnv(),
    AI_TEXT_PROVIDER_ORDER: "deepseek, gemini",
    AI_FALLBACK_ENABLED: "false",
    GEMINI_API_KEY: "secret",
    GEMINI_MODEL: "gemini-2.0-flash",
  });
  assert.deepEqual(config.AI_TEXT_PROVIDER_ORDER, ["deepseek", "gemini"]);
  assert.equal(config.AI_FALLBACK_ENABLED, false);
  assert.equal(config.GEMINI_API_KEY, "secret");
});

test("Config: отсутствие DATABASE_URL отклоняется", () => {
  const { DATABASE_URL: _removed, ...rest } = validEnv();
  assert.throws(() => parseEnv(rest), ZodError);
});

test("Config: короткие секреты отклоняются", () => {
  assert.throws(
    () =>
      parseEnv({
        ...validEnv(),
        SESSION_SECRET: "short",
      }),
    ZodError
  );
  assert.throws(
    () =>
      parseEnv({
        ...validEnv(),
        DATA_ENCRYPTION_KEY: "short",
      }),
    ZodError
  );
});

test("Config: неизвестные переменные отклоняются (strict)", () => {
  assert.throws(
    () =>
      parseEnv({
        ...validEnv(),
        UNKNOWN_VAR: "value",
      }),
    ZodError
  );
});

test("Config: невалидные значения чисел отклоняются", () => {
  assert.throws(
    () =>
      parseEnv({
        ...validEnv(),
        MAX_PDF_PAGES: "0",
      }),
    ZodError
  );
  assert.throws(
    () =>
      parseEnv({
        ...validEnv(),
        MAX_UPLOAD_BYTES: "abc",
      }),
    ZodError
  );
});

test("Config: loadConfig принимает параметр окружения без process.env", () => {
  const config = loadConfig(validEnv());
  assert.equal(config.NODE_ENV, "test");
});

test("Config: loadConfig игнорирует посторонние ключи process.env (strict)", () => {
  const config = loadConfig({
    ...validEnv(),
    ...(Object.fromEntries(
      ["PATH", "OS", "USERNAME", "SystemRoot"].map((key) => [key, "irrelevant"])
    ) as NodeJS.ProcessEnv),
  });
  assert.equal(config.NODE_ENV, "test");
  assert.equal(config.APP_URL, "http://localhost:3000");
});

test("Config: EnvSchema strict с typed ошибками", () => {
  const result = EnvSchema.safeParse({ ...validEnv(), LOG_LEVEL: "verbose" });
  assert.equal(result.success, false);
});

function ZodError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}
