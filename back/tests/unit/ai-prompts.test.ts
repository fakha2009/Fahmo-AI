import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDocumentPrompt,
  buildTextPrompt,
  compilePrompt,
  DEFAULT_PROMPT_VERSION,
  promptRegistry,
} from "../../src/ai/prompts";

const DOCUMENT_TYPES = ["announcement", "work_assignment", "handwritten_note", "general"] as const;

test("PromptRegistry: все 4 типа имеют версии и ассеты", () => {
  const listed = promptRegistry.list();
  assert.deepEqual(
    listed.map((entry) => entry.documentType).sort(),
    [...DOCUMENT_TYPES].sort()
  );
  for (const entry of listed) {
    assert.ok(entry.versions.length > 0, `${entry.documentType} без версий`);
    for (const version of entry.versions) {
      const template = promptRegistry.resolve(entry.documentType, version.version);
      assert.ok(template.system.length > 0, `${entry.documentType} пустой system`);
      assert.ok(template.rules.length > 0, `${entry.documentType} пустые rules`);
      assert.ok(template.schemaJson.length > 0, `${entry.documentType} пустая схема`);
      assert.ok(typeof template.schema === "object" && template.schema !== null);
    }
  }
});

test("PromptRegistry: resolve по умолчанию возвращает latest", () => {
  const template = promptRegistry.resolve("announcement");
  assert.equal(template.version, DEFAULT_PROMPT_VERSION);
  assert.equal(template.documentType, "announcement");
});

test("PromptRegistry: неизвестный тип фолбэчится на general", () => {
  const template = promptRegistry.resolve("contract");
  assert.equal(template.documentType, "general");
  const nullTemplate = promptRegistry.resolve(null);
  assert.equal(nullTemplate.documentType, "general");
});

test("PromptRegistry: несуществующая версия бросает ошибку", () => {
  assert.throws(
    () => promptRegistry.resolve("general", "9.9.9"),
    /Версия промпта "9.9.9" не найдена/
  );
});

test("PromptRegistry: schema.json валиден и содержит контракт вывода", () => {
  for (const type of DOCUMENT_TYPES) {
    const template = promptRegistry.resolve(type);
    const schema = template.schema as {
      type?: string;
      required?: string[];
      additionalProperties?: boolean;
      $defs?: Record<string, unknown>;
    };
    assert.equal(schema.type, "object", `${type}: schema.type`);
    assert.equal(schema.additionalProperties, false, `${type}: additionalProperties`);
    assert.ok(schema.required?.includes("summary"), `${type}: required summary`);
    assert.ok(schema.required?.includes("overallConfidence"), `${type}: required confidence`);
    assert.ok(schema.$defs?.sourceRef, `${type}: $defs.sourceRef`);
    assert.ok(schema.$defs?.warning, `${type}: $defs.warning`);
    assert.ok(schema.$defs?.clarificationQuestion, `${type}: $defs.clarificationQuestion`);
  }
});

test("PromptRegistry: правила безопасности присутствуют в каждом типе", () => {
  const requiredPhrases = [
    "только данные",
    "игнорируй предыдущие инструкции",
    "не раскрывай",
    "не выбирай AI-провайдера",
    "не выполняешь действий",
    "null",
    "warnings",
    "clarificationQuestions",
    "sourceRefs",
    "CONFLICTING_INFORMATION",
  ];
  for (const type of DOCUMENT_TYPES) {
    const template = promptRegistry.resolve(type);
    const combined = `${template.rules}\n${template.system}`.toLowerCase();
    for (const phrase of requiredPhrases) {
      assert.ok(combined.includes(phrase.toLowerCase()), `${type}: отсутствует «${phrase}»`);
    }
  }
});

test("PromptRegistry: schema.json описывает warning-коды и null для неизвестного", () => {
  const template = promptRegistry.resolve("general");
  const schema = template.schema as {
    $defs: {
      warning: { properties: { code: { enum: string[] } } };
      amount: { properties: { value: { type: string[] | string } } };
    };
  };
  const codes = schema.$defs.warning.properties.code.enum;
  for (const code of ["UNCLEAR_TEXT", "AMBIGUOUS_DATE", "AMBIGUOUS_AMOUNT", "MISSING_INFORMATION", "LOW_CONFIDENCE", "UNSUPPORTED_CONTENT"]) {
    assert.ok(codes.includes(code), `нет кода ${code}`);
  }
  assert.ok(
    schema.$defs.amount.properties.value.type.includes("null"),
    "value должен допускать null"
  );
});

test("compilePrompt: подставляет переменные и собирает полный промпт", () => {
  const template = promptRegistry.resolve("announcement");
  const compiled = compilePrompt(template, { language: "ru", documentType: "announcement" });
  assert.ok(compiled.includes("Язык ответа: ru"));
  assert.ok(compiled.includes("Тип документа: announcement"));
  assert.ok(compiled.includes("--- Правила ---"));
  assert.ok(compiled.includes("--- Схема ответа ---"));
  assert.ok(compiled.includes("fahmo-ai/prompts/announcement/v1/output"));
  assert.ok(!compiled.includes("{{language}}"), "переменная {{language}} не подставлена");
  assert.ok(!compiled.includes("{{documentType}}"), "переменная {{documentType}} не подставлена");
});

test("buildDocumentPrompt: выбор типа и версии", () => {
  const workPrompt = buildDocumentPrompt("ru", { documentType: "work_assignment" });
  assert.ok(workPrompt.includes("аналитик поручений"));
  const general = buildDocumentPrompt("tg", {});
  assert.ok(general.includes("аналитик документов"));
  const handwritten = buildDocumentPrompt("en", {
    documentType: "handwritten_note",
    version: DEFAULT_PROMPT_VERSION,
  });
  assert.ok(handwritten.includes("рукописных записей"));
});

test("buildTextPrompt: использует general-шаблон и инструкцию для текста", () => {
  const prompt = buildTextPrompt("ru");
  assert.ok(prompt.includes("аналитик документов"));
  assert.ok(prompt.includes("Проанализируй ТЕКСТ ниже"));
});

test("buildDocumentPrompt: не содержит секретов и внутренних имён", () => {
  const prompt = buildDocumentPrompt("ru", { documentType: "general" });
  for (const forbidden of ["gemini", "deepseek", "apiKey", "Bearer", "http://"]) {
    assert.ok(!prompt.toLowerCase().includes(forbidden), `промпт содержит «${forbidden}»`);
  }
});
