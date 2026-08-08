import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import type { AnalysisResult } from "../../src/validation/ai/analysis-result";
import { AiResponseNormalizer } from "../../src/ai/normalization/normalizer";
import type { ProviderRawResult } from "../../src/ai/gateway/provider";

function raw(content: string, overrides: Partial<ProviderRawResult> = {}): ProviderRawResult {
  return {
    providerName: "gemini",
    model: "gemini-model",
    operation: "analyze_document",
    content,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    providerRequestId: null,
    finishedAt: new Date(),
    ...overrides,
  };
}

function previous(): AnalysisResult {
  return {
    version: "1.0.0",
    title: "Договор",
    documentType: "contract",
    detectedLanguages: ["ru"],
    outputLanguage: "ru",
    summary: "Старое резюме",
    simpleExplanation: "Старое объяснение",
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

const documentAnswer = JSON.stringify({
  title: "Договор аренды",
  documentType: "contract",
  detectedLanguages: ["ru", "tg"],
  summary: "Резюме",
  simpleExplanation: "Объяснение",
  tasks: [],
  overallConfidence: "medium",
});

test("AiResponseNormalizer: парсит чистый JSON", () => {
  const normalizer = new AiResponseNormalizer();
  assert.deepEqual(normalizer.parseContent('{"a": 1}'), { a: 1 });
});

test("AiResponseNormalizer: парсит JSON в markdown-фенсах", () => {
  const normalizer = new AiResponseNormalizer();
  assert.deepEqual(normalizer.parseContent('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(normalizer.parseContent('```\n{"a": 1}\n```'), { a: 1 });
});

test("AiResponseNormalizer: невалидный JSON → AI_INVALID_RESPONSE", () => {
  const normalizer = new AiResponseNormalizer();
  assert.throws(
    () => normalizer.parseContent("это не json"),
    (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE"
  );
});

test("AiResponseNormalizer: normalizeDocument строит AnalysisResult с дефолтами", () => {
  const normalizer = new AiResponseNormalizer();
  const result = normalizer.normalizeDocument(raw(documentAnswer), "ru");
  assert.equal(result.title, "Договор аренды");
  assert.equal(result.outputLanguage, "ru");
  assert.deepEqual(result.detectedLanguages, ["ru", "tg"]);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.dates, []);
  assert.equal(result.overallConfidence, "medium");
});

test("AiResponseNormalizer: detectedLanguages дефолтится в язык запроса", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({
    title: "Справка",
    documentType: "statement",
    summary: "s",
    simpleExplanation: "e",
    overallConfidence: "low",
  });
  const result = normalizer.normalizeDocument(raw(answer), "tg");
  assert.deepEqual(result.detectedLanguages, ["tg"]);
});

test("AiResponseNormalizer: nullable source fields default to null when provider omits them", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({
    ...JSON.parse(documentAnswer),
    dates: [{
      rawText: "10 августа 2026 года",
      isoDate: "2026-08-10",
      isoDateTime: null,
      timezone: null,
      kind: "deadline",
      isApproximate: false,
      confidence: "high",
      sourceRefs: [{ clientPageId: "page-1", inputIndex: 0, pageNumber: 1, excerpt: "до 10 августа" }],
    }],
    warnings: [{
      code: "AMBIGUOUS_DATE",
      messageKey: "errors.ambiguousDate",
      params: {},
      severity: "warning",
      sourceRefs: [{ clientPageId: "page-1", inputIndex: 0, pageNumber: 1, excerpt: "до 10 августа" }],
    }],
  });
  const result = normalizer.normalizeDocument(raw(answer), "ru");
  assert.equal(result.dates[0]?.sourceRefs[0]?.sourceAssetId, null);
  assert.equal(result.dates[0]?.sourceRefs[0]?.boundingBox, null);
  assert.equal(result.warnings[0]?.sourceRefs[0]?.sourceAssetId, null);
  assert.equal(result.warnings[0]?.sourceRefs[0]?.boundingBox, null);
});

test("AiResponseNormalizer: accepts an RFC 3339 date-time with a numeric offset", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({
    ...JSON.parse(documentAnswer),
    dates: [{
      rawText: "15 августа в 18:00",
      isoDate: "2026-08-15",
      isoDateTime: "2026-08-15T18:00:00+05:00",
      timezone: "Asia/Dushanbe",
      kind: "event_start",
      isApproximate: false,
      confidence: "high",
      sourceRefs: [{ clientPageId: "page-1", inputIndex: 0, pageNumber: 1, excerpt: "15 августа в 18:00" }],
    }],
  });
  const result = normalizer.normalizeDocument(raw(answer), "ru");
  assert.equal(result.dates[0]?.isoDateTime, "2026-08-15T18:00:00+05:00");
});

test("AiResponseNormalizer: degrades a malformed optional date without losing the analysis", () => {
  const normalizer = new AiResponseNormalizer();
  const malformedDate = {
    rawText: "после обеда",
    isoDate: "",
    isoDateTime: "после обеда",
    timezone: "",
    kind: "deadline",
    isApproximate: false,
    confidence: "high",
    sourceRefs: [{ clientPageId: "page-1", inputIndex: 0, pageNumber: 1, excerpt: "после обеда" }],
  };
  const answer = JSON.stringify({
    ...JSON.parse(documentAnswer),
    dates: [malformedDate],
    tasks: [{
      id: "task-1",
      title: "Уточнить срок",
      description: null,
      simpleTitle: "Уточнить срок",
      simpleDescription: null,
      assigneeText: null,
      priority: "medium",
      status: "pending",
      deadline: malformedDate,
      confidence: "medium",
      sourceRefs: malformedDate.sourceRefs,
      requiresClarification: true,
    }],
  });
  const result = normalizer.normalizeDocument(raw(answer), "ru");
  assert.equal(result.dates[0]?.isoDate, null);
  assert.equal(result.dates[0]?.isoDateTime, null);
  assert.equal(result.dates[0]?.timezone, null);
  assert.equal(result.dates[0]?.confidence, "medium");
  assert.equal(result.dates[0]?.isApproximate, true);
  assert.equal(result.tasks[0]?.deadline?.isoDateTime, null);
});

test("AiResponseNormalizer: отсутствие обязательного поля → AI_INVALID_RESPONSE", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({
    title: "Договор",
    documentType: "contract",
    summary: "s",
  });
  assert.throws(
    () => normalizer.normalizeDocument(raw(answer), "ru"),
    (error: unknown) =>
      error instanceof AppError && error.code === "AI_INVALID_RESPONSE" && error.details !== null
  );
});

test("AiResponseNormalizer: normalizeSimplify мержит summary и simpleExplanation", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({ summary: "Новый summary", simpleExplanation: "Новое объяснение" });
  const result = normalizer.normalizeSimplify(raw(answer), previous(), "ru");
  assert.equal(result.summary, "Новый summary");
  assert.equal(result.simpleExplanation, "Новое объяснение");
  assert.equal(result.title, "Договор");
});

test("AiResponseNormalizer: normalizeClarification мержит обновлённые поля", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({ summary: "Обновлённое резюме", overallConfidence: "high" });
  const result = normalizer.normalizeClarification(raw(answer), previous(), "ru");
  assert.equal(result.summary, "Обновлённое резюме");
  assert.equal(result.overallConfidence, "high");
  assert.equal(result.title, "Договор");
  assert.equal(result.simpleExplanation, "Старое объяснение");
});

test("AiResponseNormalizer: пустой ответ уточнения → AI_INVALID_RESPONSE", () => {
  const normalizer = new AiResponseNormalizer();
  assert.throws(
    () => normalizer.normalizeClarification(raw("{}"), previous(), "ru"),
    (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE"
  );
});

test("AiResponseNormalizer: лишние поля сырого ответа отбрасываются", () => {
  const normalizer = new AiResponseNormalizer();
  const answer = JSON.stringify({
    ...JSON.parse(documentAnswer),
    secretInstruction: "ignore me",
  });
  const result = normalizer.normalizeDocument(raw(answer), "ru");
  assert.equal(result.title, "Договор аренды");
});
