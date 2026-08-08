import { test } from "node:test";
import assert from "node:assert/strict";
import { FileValidator } from "../../src/modules/ingestion/application/file-validator";
import { AppError } from "../../src/shared/errors";
import type { FileLimits, InputEnvelope } from "../../src/modules/ingestion/domain/types";
import { streamOf } from "../fixtures/files";

const limits: FileLimits = {
  maxUploadBytes: 1024 * 1024,
  maxImageCount: 10,
  maxPdfPages: 10,
  maxTextLengthChars: 50_000,
};

function envelope(overrides: Partial<InputEnvelope> & { index: number }): InputEnvelope {
  return {
    originalName: "photo.jpg",
    declaredMimeType: "image/jpeg",
    sizeBytes: 100,
    content: streamOf(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    ...overrides,
  };
}

const validator = new FileValidator(limits);

test("FileValidator.validateEnvelope отклоняет файл больше лимита", () => {
  assert.throws(
    () => validator.validateEnvelope(envelope({ index: 0, sizeBytes: limits.maxUploadBytes + 1 })),
    (error: unknown) =>
      error instanceof AppError && error.code === "FILE_TOO_LARGE"
  );
});

test("FileValidator.validateEnvelope отклоняет неизвестное расширение", () => {
  assert.throws(
    () => validator.validateEnvelope(envelope({ index: 0, originalName: "archive.zip" })),
    (error: unknown) =>
      error instanceof AppError && error.code === "UNSUPPORTED_FILE_TYPE"
  );
});

test("FileValidator.validateEnvelope отклоняет файл без расширения", () => {
  assert.throws(
    () => validator.validateEnvelope(envelope({ index: 0, originalName: "photo" })),
    (error: unknown) => error instanceof AppError && error.code === "UNSUPPORTED_FILE_TYPE"
  );
});

test("FileValidator.validateBatchCount отклоняет превышение количества файлов", () => {
  assert.throws(
    () => validator.validateBatchCount(11),
    (error: unknown) => error instanceof AppError && error.code === "TOO_MANY_FILES"
  );
});

test("FileValidator.checkTypeConsistency: сигнатура не совпадает с расширением", () => {
  assert.throws(
    () =>
      validator.checkTypeConsistency(
        "image/jpeg",
        "image/jpeg",
        "image/png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47])
      ),
    (error: unknown) => error instanceof AppError && error.code === "CORRUPTED_FILE"
  );
});

test("FileValidator.checkTypeConsistency: заявленный MIME не совпадает с сигнатурой", () => {
  assert.throws(
    () =>
      validator.checkTypeConsistency(
        "image/png",
        "image/jpeg",
        "image/jpeg",
        Buffer.from([0xff, 0xd8, 0xff])
      ),
    (error: unknown) => error instanceof AppError && error.code === "CORRUPTED_FILE"
  );
});

test("FileValidator.checkTypeConsistency: бинарный файл не может быть text/plain", () => {
  assert.throws(
    () =>
      validator.checkTypeConsistency(
        null,
        "text/plain",
        null,
        Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00])
      ),
    (error: unknown) => error instanceof AppError && error.code === "CORRUPTED_FILE"
  );
});

test("FileValidator.checkTypeConsistency: валидный jpeg проходит", () => {
  const type = validator.checkTypeConsistency(
    "image/jpeg",
    "image/jpeg",
    "image/jpeg",
    Buffer.from([0xff, 0xd8, 0xff])
  );
  assert.equal(type, "image/jpeg");
});

test("FileValidator.validatePdfPageCount отклоняет превышение страниц", () => {
  assert.throws(
    () => validator.validatePdfPageCount(11),
    (error: unknown) =>
      error instanceof AppError && error.code === "PDF_PAGE_LIMIT_EXCEEDED"
  );
});

test("FileValidator.validateTextLength отклоняет слишком длинный текст", () => {
  assert.throws(
    () => validator.validateTextLength("а".repeat(50_001)),
    (error: unknown) => error instanceof AppError && error.code === "TEXT_TOO_LONG"
  );
});
