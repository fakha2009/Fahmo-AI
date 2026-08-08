import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  airRunFinalStatus,
  airRunOperation,
  analysisStage,
  analysisStatus,
  clarificationStatus,
  confidenceLevel,
  documentType,
  explanationMode,
  outputLanguage,
  retentionMode,
  sourcePreviewMode,
  sourceType,
} from "../../src/database/mappers";

test("Mappers: analysisStatus round-trip", () => {
  const statuses = ["queued", "validating", "processing", "needs_clarification", "completed", "failed", "cancelled"] as const;
  for (const value of statuses) {
    assert.equal(analysisStatus.fromPrisma(analysisStatus.toPrisma(value)), value);
  }
  assert.equal(analysisStatus.toPrisma("queued"), "QUEUED");
  assert.equal(analysisStatus.fromPrisma("NEEDS_CLARIFICATION"), "needs_clarification");
});

test("Mappers: analysisStage round-trip", () => {
  const stages = [
    "queued",
    "validating",
    "preparing_files",
    "extracting_content",
    "detecting_document_type",
    "analyzing",
    "checking_result",
    "normalizing",
    "saving",
    "completed",
  ] as const;
  for (const value of stages) {
    assert.equal(analysisStage.fromPrisma(analysisStage.toPrisma(value)), value);
  }
  assert.equal(analysisStage.toPrisma("detecting_document_type"), "DETECTING_DOCUMENT_TYPE");
  assert.equal(analysisStage.fromPrisma("PREPARING_FILES"), "preparing_files");
});

test("Mappers: documentType (12 значений) round-trip", () => {
  const types = [
    "announcement",
    "work_assignment",
    "handwritten_note",
    "contract",
    "invoice",
    "certificate",
    "identity",
    "statement",
    "letter",
    "notice",
    "receipt",
    "other",
  ] as const;
  for (const value of types) {
    assert.equal(documentType.fromPrisma(documentType.toPrisma(value)), value);
  }
  assert.equal(documentType.toPrisma("handwritten_note"), "HANDWRITTEN_NOTE");
  assert.equal(documentType.fromPrisma("RECEIPT"), "receipt");
});

test("Mappers: остальные enum round-trip", () => {
  for (const value of ["ru", "tg", "en"] as const) {
    assert.equal(outputLanguage.fromPrisma(outputLanguage.toPrisma(value)), value);
  }
  for (const value of ["high", "medium", "low"] as const) {
    assert.equal(confidenceLevel.fromPrisma(confidenceLevel.toPrisma(value)), value);
  }
  for (const value of ["text", "image", "pdf", "multi_image"] as const) {
    assert.equal(sourceType.fromPrisma(sourceType.toPrisma(value)), value);
  }
  for (const value of ["standard", "simple"] as const) {
    assert.equal(explanationMode.fromPrisma(explanationMode.toPrisma(value)), value);
  }
  for (const value of ["history", "temporary"] as const) {
    assert.equal(retentionMode.fromPrisma(retentionMode.toPrisma(value)), value);
  }
  for (const value of ["history", "temporary", "no_preview"] as const) {
    assert.equal(sourcePreviewMode.fromPrisma(sourcePreviewMode.toPrisma(value)), value);
  }
  for (const value of ["open", "answered", "cancelled"] as const) {
    assert.equal(clarificationStatus.fromPrisma(clarificationStatus.toPrisma(value)), value);
  }
});

test("Mappers: AIRun операции и финальный статус", () => {
  assert.equal(airRunOperation.toPrisma("analyze_document"), "ANALYZE_DOCUMENT");
  assert.equal(airRunOperation.toPrisma("analyze_text"), "ANALYZE_TEXT");
  assert.equal(airRunOperation.toPrisma("answer_clarification"), "ANSWER_CLARIFICATION");
  assert.equal(airRunOperation.toPrisma("simplify_result"), "SIMPLIFY_RESULT");
  assert.equal(airRunOperation.fromPrisma("SIMPLIFY_RESULT"), "simplify_result");
  assert.equal(airRunFinalStatus.toPrisma("success"), "SUCCESS");
  assert.equal(airRunFinalStatus.toPrisma("failed"), "FAILED");
  assert.equal(airRunFinalStatus.fromPrisma("SUCCESS"), "success");
});
