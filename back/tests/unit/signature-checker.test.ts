import { test } from "node:test";
import assert from "node:assert/strict";
import { SignatureChecker } from "../../src/modules/ingestion/application/signature-checker";
import { streamToBuffer } from "../../src/shared/utils/stream";
import { makeImage, makePdf, streamOf } from "../fixtures/files";

test("SignatureChecker.probe не теряет данные и определяет тип", async () => {
  const source = await makeImage({ format: "jpeg" });
  const { stream, firstBytes } = await SignatureChecker.probe(streamOf(source));
  assert.ok(firstBytes.length > 0 && firstBytes.length <= 64);
  assert.equal(SignatureChecker.check(firstBytes), "image/jpeg");
  const remainder = await streamToBuffer(stream);
  assert.deepEqual(remainder, source);
});

test("SignatureChecker.check распознаёт PNG и PDF", async () => {
  const png = await makeImage({ format: "png" });
  const pdf = await makePdf(2);
  assert.equal(SignatureChecker.check(png), "image/png");
  assert.equal(SignatureChecker.check(pdf), "application/pdf");
});

test("SignatureChecker.check возвращает null для текста", () => {
  assert.equal(SignatureChecker.check(Buffer.from("hello world")), null);
});
