import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeTextUploadFilename } from "../../src/http/routes/analyses";

test("text multipart parts without an extension are normalized before validation", () => {
  assert.equal(normalizeTextUploadFilename("Текст"), "Текст.txt");
  assert.equal(normalizeTextUploadFilename("notes.txt"), "notes.txt");
  assert.equal(normalizeTextUploadFilename("", 2), "document_3.txt");
});
