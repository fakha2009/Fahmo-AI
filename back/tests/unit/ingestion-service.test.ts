import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorageAdapter } from "../../src/storage/adapters/local";
import { FileValidator } from "../../src/modules/ingestion/application/file-validator";
import { ImageProcessor } from "../../src/modules/ingestion/application/image-processor";
import { PdfProcessor } from "../../src/modules/ingestion/application/pdf-processor";
import { TemporaryStorageService } from "../../src/modules/ingestion/application/temporary-storage";
import { SourcePreviewService } from "../../src/modules/ingestion/application/source-preview";
import { IngestionService } from "../../src/modules/ingestion/application/ingestion-service";
import { AppError } from "../../src/shared/errors";
import type { FileLimits, InputEnvelope, PreviewPolicy } from "../../src/modules/ingestion/domain/types";
import { makeEncryptedPdf, makeImage, makePdf, makeText, streamOf } from "../fixtures/files";

const limits: FileLimits = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxImageCount: 10,
  maxPdfPages: 10,
  maxTextLengthChars: 50_000,
};

const policy: PreviewPolicy = { mode: "history", ttl: { days: 30 } };

function buildService(root: string): {
  service: IngestionService;
  storage: LocalStorageAdapter;
} {
  const storage = new LocalStorageAdapter(root);
  const service = new IngestionService(
    new FileValidator(limits),
    new ImageProcessor(),
    new PdfProcessor(),
    new TemporaryStorageService(storage),
    new SourcePreviewService(storage)
  );
  return { service, storage };
}

function envelope(index: number, originalName: string, mime: string | null, buffer: Buffer): InputEnvelope {
  return { index, originalName, declaredMimeType: mime, sizeBytes: buffer.length, content: streamOf(buffer) };
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "fahmo-ingest-"));
  await run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("IngestionService: одно изображение без манифеста — синтез позиции и превью", () =>
  withRoot(async (root) => {
    const { service, storage } = buildService(root);
    const jpeg = await makeImage({ format: "jpeg" });
    const result = await service.ingest(
      [envelope(0, "school.jpg", "image/jpeg", jpeg)],
      null,
      { previewPolicy: policy }
    );
    assert.equal(result.files.length, 1);
    const file = result.files[0];
    assert.ok(file !== undefined);
    assert.equal(file.type, "image/jpeg");
    assert.equal(file.pageCount, 1);
    assert.ok(file.stagingKey !== null);
    assert.equal(file.previews.length, 1);
    assert.equal(file.previews[0]?.clientPageId, "page-0");
    assert.equal((await storage.list("staging/")).length, 1);
    assert.equal((await storage.list("previews/")).length, 1);
  }));

test("IngestionService: rotation и crop из манифеста применяются", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const png = await makeImage({ format: "png", width: 200, height: 100 });
    const result = await service.ingest(
      [envelope(0, "page.png", "image/png", png)],
      [
        {
          clientPageId: "page-a",
          fileIndex: 0,
          sourcePageNumber: null,
          finalOrder: 0,
          rotation: 90,
          crop: { x: 0, y: 0, width: 1, height: 0.5 },
        },
      ],
      { previewPolicy: policy }
    );
    const file = result.files[0];
    assert.ok(file !== undefined);
    assert.equal(file.width, 100);
    assert.equal(file.height, 100);
  }));

test("IngestionService: PDF проходит валидацию страниц и не создаёт превью", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const pdf = await makePdf(3);
    const result = await service.ingest(
      [envelope(0, "doc.pdf", "application/pdf", pdf)],
      [
        {
          clientPageId: "page-pdf",
          fileIndex: 0,
          sourcePageNumber: 2,
          finalOrder: 0,
          rotation: 0,
          crop: null,
        },
      ],
      { previewPolicy: policy }
    );
    const file = result.files[0];
    assert.ok(file !== undefined);
    assert.equal(file.pageCount, 3);
    assert.ok(file.stagingKey !== null);
    assert.equal(file.previews.length, 0);
  }));

test("IngestionService: PDF с превышением страниц отклоняется", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const pdf = await makePdf(11);
    await assert.rejects(
      service.ingest([envelope(0, "big.pdf", "application/pdf", pdf)], null, {
        previewPolicy: policy,
      }),
      (error: unknown) => error instanceof AppError && error.code === "PDF_PAGE_LIMIT_EXCEEDED"
    );
  }));

test("IngestionService: текст обрабатывается и хешируется", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const text = makeText("Собрание в 10:00");
    const result = await service.ingest(
      [envelope(0, "note.txt", "text/plain", text)],
      null,
      { previewPolicy: policy }
    );
    const file = result.files[0];
    assert.ok(file !== undefined);
    assert.equal(file.type, "text/plain");
    assert.equal(file.stagingKey, null);
    assert.equal(file.sizeBytes, text.length);
    assert.equal(file.previews.length, 0);
  }));

test("IngestionService: несколько файлов без манифеста отклоняются", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const jpeg = await makeImage();
    await assert.rejects(
      service.ingest(
        [envelope(0, "a.jpg", "image/jpeg", jpeg), envelope(1, "b.jpg", "image/jpeg", jpeg)],
        null,
        { previewPolicy: policy }
      ),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
    );
  }));

test("IngestionService: дубликат clientPageId отклоняется схемой", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const jpeg = await makeImage();
    const manifest = [
      { clientPageId: "dup", fileIndex: 0, sourcePageNumber: null, finalOrder: 0, rotation: 0 as const, crop: null },
      { clientPageId: "dup", fileIndex: 1, sourcePageNumber: null, finalOrder: 1, rotation: 0 as const, crop: null },
    ];
    await assert.rejects(
      service.ingest(
        [envelope(0, "a.jpg", "image/jpeg", jpeg), envelope(1, "b.jpg", "image/jpeg", jpeg)],
        manifest,
        { previewPolicy: policy }
      ),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
    );
  }));

test("IngestionService: sourcePageNumber за пределами PDF отклоняется", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const pdf = await makePdf(2);
    await assert.rejects(
      service.ingest(
        [envelope(0, "doc.pdf", "application/pdf", pdf)],
        [
          {
            clientPageId: "p",
            fileIndex: 0,
            sourcePageNumber: 5,
            finalOrder: 0,
            rotation: 0,
            crop: null,
          },
        ],
        { previewPolicy: policy }
      ),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
    );
  }));

test("IngestionService: cleanup в finally удаляет staged-объекты при ошибке", () =>
  withRoot(async (root) => {
    const { service, storage } = buildService(root);
    const jpeg = await makeImage();
    const encrypted = await makeEncryptedPdf();
    await assert.rejects(
      service.ingest(
        [
          envelope(0, "ok.jpg", "image/jpeg", jpeg),
          envelope(1, "secret.pdf", "application/pdf", encrypted),
        ],
        [
          { clientPageId: "a", fileIndex: 0, sourcePageNumber: null, finalOrder: 0, rotation: 0, crop: null },
          { clientPageId: "b", fileIndex: 1, sourcePageNumber: 1, finalOrder: 1, rotation: 0, crop: null },
        ],
        { previewPolicy: policy }
      ),
      (error: unknown) => error instanceof AppError && error.code === "PDF_PASSWORD_PROTECTED"
    );
    assert.equal((await storage.list("staging/")).length, 0);
    assert.equal((await storage.list("previews/")).length, 0);
  }));

test("IngestionService: лимит размера файла отклоняется до обработки", () =>
  withRoot(async (root) => {
    const { service } = buildService(root);
    const jpeg = await makeImage();
    const tooBig = {
      ...envelope(0, "big.jpg", "image/jpeg", jpeg),
      sizeBytes: limits.maxUploadBytes + 1,
    };
    await assert.rejects(
      service.ingest([tooBig], null, { previewPolicy: policy }),
      (error: unknown) => error instanceof AppError && error.code === "FILE_TOO_LARGE"
    );
  }));
