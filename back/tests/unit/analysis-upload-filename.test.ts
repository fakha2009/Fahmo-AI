import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildManifest, normalizeTextUploadFilename, type UploadUnit } from "../../src/http/routes/analyses";

test("text multipart parts without an extension are normalized before validation", () => {
  assert.equal(normalizeTextUploadFilename("Текст"), "Текст.txt");
  assert.equal(normalizeTextUploadFilename("notes.txt"), "notes.txt");
  assert.equal(normalizeTextUploadFilename("", 2), "document_3.txt");
});

test("explicit source ids keep reordered PDF pages attached to one upload", () => {
  const upload: UploadUnit = {
    filename: "document.pdf",
    contentType: "application/pdf",
    buffer: Buffer.from("pdf"),
    kind: "pdf",
    sourceId: "source-pdf",
  };
  const manifest = buildManifest([
    { id: "page-2", sourceId: "source-pdf", order: 0, rotation: 0, kind: "pdf", sourcePage: 2 },
    { id: "page-1", sourceId: "source-pdf", order: 1, rotation: 0, kind: "pdf", sourcePage: 1 },
  ], [upload]);

  assert.deepEqual(manifest.map((item) => ({ fileIndex: item.fileIndex, sourcePageNumber: item.sourcePageNumber })), [
    { fileIndex: 0, sourcePageNumber: 2 },
    { fileIndex: 0, sourcePageNumber: 1 },
  ]);
});
