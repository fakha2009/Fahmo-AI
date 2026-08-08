import assert from "node:assert/strict";
import test from "node:test";
import { mapAnalysisResult } from "../../src/http/mappers/result";
import { attachSourceAssetIds } from "../../src/modules/analysis/application/source-reference-binder";
import type { AnalysisRecord } from "../../src/modules/analysis/application/analysis-repository";
import { AnalysisResultSchema, type AnalysisResult } from "../../src/validation/ai/analysis-result";

const source = {
  clientPageId: "page-1",
  sourceAssetId: null,
  inputIndex: 0,
  pageNumber: 1,
  excerpt: "до 20 августа подготовить отчёт",
  boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.08 },
};

function analysisResult(): AnalysisResult {
  return AnalysisResultSchema.parse({
    version: "1.0",
    title: "Поручение",
    documentType: "work_assignment",
    detectedLanguages: ["ru"],
    outputLanguage: "ru",
    summary: "Нужно подготовить отчёт.",
    simpleExplanation: "Подготовьте отчёт до срока.",
    tasks: [{
      id: "task-1",
      title: "Подготовить отчёт",
      description: null,
      simpleTitle: "Сделать отчёт",
      simpleDescription: null,
      assigneeText: null,
      priority: "high",
      status: "pending",
      deadline: null,
      confidence: "high",
      sourceRefs: [source],
      requiresClarification: false,
    }],
    dates: [
      { rawText: "20 августа 2026", isoDate: "2026-08-20", isoDateTime: null, timezone: null, kind: "deadline", isApproximate: false, confidence: "high", sourceRefs: [source] },
      { rawText: "ДАТА", isoDate: null, isoDateTime: null, timezone: null, kind: "other", isApproximate: true, confidence: "low", sourceRefs: [source] },
    ],
    amounts: [{ rawText: "СУММА", value: null, currency: null, confidence: "low", sourceRefs: [source] }],
    locations: [],
    contacts: [],
    requiredDocuments: [{ name: "Копия паспорта", description: null, confidence: "high", sourceRefs: [source] }],
    links: [],
    warnings: [{ code: "LOW_CONFIDENCE", messageKey: "errors.low_confidence_handwriting", params: {}, severity: "warning", sourceRefs: [source] }],
    clarificationQuestions: [],
    overallConfidence: "medium",
  });
}

function record(result: AnalysisResult): AnalysisRecord {
  const now = new Date("2026-08-08T00:00:00.000Z");
  return {
    id: "analysis-1",
    sessionId: "session-1",
    userId: null,
    status: "completed",
    stage: "completed",
    progress: 100,
    sourceType: "image",
    documentType: "work_assignment",
    outputLanguage: "ru",
    result,
    detectedLanguages: ["ru"],
    provider: "openai",
    model: "test-model",
    errorCode: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

test("source assets are attached to every returned source reference", () => {
  const attached = attachSourceAssetIds(analysisResult(), new Map([["page-1", "asset-1"]]));
  assert.equal(attached.tasks[0]?.sourceRefs[0]?.sourceAssetId, "asset-1");
  assert.equal(attached.dates[0]?.sourceRefs[0]?.sourceAssetId, "asset-1");
  assert.equal(attached.requiredDocuments[0]?.sourceRefs[0]?.sourceAssetId, "asset-1");
  assert.equal(attached.warnings[0]?.sourceRefs[0]?.sourceAssetId, "asset-1");
});

test("result mapper keeps actionable important data and complete source coordinates", () => {
  const attached = attachSourceAssetIds(analysisResult(), new Map([["page-1", "asset-1"]]));
  const mapped = mapAnalysisResult(record(attached));
  assert.ok(mapped !== null);
  assert.deepEqual(mapped.importantData.map((item) => item.type).sort(), ["deadline", "document"]);
  assert.equal(mapped.importantData.some((item) => item.value === "ДАТА" || item.value === "СУММА"), false);
  assert.equal(mapped.tasks[0]?.source?.sourceAssetId, "asset-1");
  assert.deepEqual(mapped.tasks[0]?.source?.boundingBox, source.boundingBox);
  assert.equal(mapped.warnings[0]?.source?.excerpt, source.excerpt);
});
