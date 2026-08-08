import { test } from "node:test";
import assert from "node:assert/strict";
import { PdfProcessor } from "../../src/modules/ingestion/application/pdf-processor";
import { AppError } from "../../src/shared/errors";
import { makeEncryptedPdf, makePdf } from "../fixtures/files";

const processor = new PdfProcessor();

test("PdfProcessor.analyze возвращает количество страниц", async () => {
  const pdf = await makePdf(3);
  const analysis = await processor.analyze(pdf);
  assert.equal(analysis.pageCount, 3);
  assert.equal(analysis.isEncrypted, false);
});

test("PdfProcessor.analyze отклоняет зашифрованный PDF", async () => {
  const pdf = await makeEncryptedPdf();
  await assert.rejects(
    processor.analyze(pdf),
    (error: unknown) => error instanceof AppError && error.code === "PDF_PASSWORD_PROTECTED"
  );
});

test("PdfProcessor.analyze отклоняет повреждённый PDF", async () => {
  await assert.rejects(
    processor.analyze(Buffer.from("%PDF-1.4 garbage data")),
    (error: unknown) => error instanceof AppError && error.code === "CORRUPTED_FILE"
  );
});
