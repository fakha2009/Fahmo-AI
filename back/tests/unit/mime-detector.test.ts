import { test } from "node:test";
import assert from "node:assert/strict";
import { MimeDetector } from "../../src/modules/ingestion/application/mime-detector";
import { makeImage, makePdf, makeText } from "../fixtures/files";

test("MimeDetector.detect распознаёт JPEG по magic bytes", async () => {
  const bytes = await makeImage({ format: "jpeg" });
  assert.equal(MimeDetector.detect(bytes), "image/jpeg");
});

test("MimeDetector.detect распознаёт PNG по magic bytes", async () => {
  const bytes = await makeImage({ format: "png" });
  assert.equal(MimeDetector.detect(bytes), "image/png");
});

test("MimeDetector.detect распознаёт WebP по magic bytes", async () => {
  const bytes = await makeImage({ format: "webp" });
  assert.equal(MimeDetector.detect(bytes), "image/webp");
});

test("MimeDetector.detect распознаёт PDF по %PDF", async () => {
  const bytes = await makePdf(1);
  assert.equal(MimeDetector.detect(bytes), "application/pdf");
});

test("MimeDetector.detect возвращает null для случайных байтов", () => {
  assert.equal(MimeDetector.detect(Buffer.from([0xde, 0xad, 0xbe, 0xef])), null);
});

test("MimeDetector.looksLikeText принимает UTF-8 текст и отклоняет бинарные байты", () => {
  assert.equal(MimeDetector.looksLikeText(makeText("Привет, мир!")), true);
  assert.equal(MimeDetector.looksLikeText(Buffer.from([0x00, 0x01, 0x02, 0xff])), false);
  assert.equal(MimeDetector.looksLikeText(Buffer.from([0xff, 0xfe, 0x00, 0x41])), false);
});

test("MimeDetector.looksLikeText accepts a probe cut inside a Cyrillic character", () => {
  const source = Buffer.from("Поручение: подготовить подробный отчёт о проекте и отправить руководителю.", "utf8");
  const probe = source.subarray(0, 64);
  assert.equal(probe.length, 64);
  assert.equal(MimeDetector.looksLikeText(probe), true);
});
