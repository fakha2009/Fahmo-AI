import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ImageProcessor } from "../../src/modules/ingestion/application/image-processor";
import { AppError } from "../../src/shared/errors";
import { makeImage } from "../fixtures/files";

const processor = new ImageProcessor();

test("ImageProcessor: EXIF удаляется, ориентация применяется (autoOrient)", async () => {
  const withExif = await makeImage({ width: 200, height: 100, exifOrientation: 6 });
  const metadata = await sharp(withExif).metadata();
  assert.equal(metadata.orientation, 6);

  const result = await processor.process({ buffer: withExif, rotation: 0, crop: null });
  const output = await sharp(result.buffer).metadata();
  assert.equal(output.orientation, undefined);
  assert.equal(output.exif, undefined);
  assert.equal(result.width, 100);
  assert.equal(result.height, 200);
});

test("ImageProcessor: rotation 90 меняет размеры местами", async () => {
  const source = await makeImage({ width: 200, height: 100 });
  const result = await processor.process({ buffer: source, rotation: 90, crop: null });
  assert.equal(result.width, 100);
  assert.equal(result.height, 200);
});

test("ImageProcessor: rotation 180 сохраняет размеры", async () => {
  const source = await makeImage({ width: 200, height: 100 });
  const result = await processor.process({ buffer: source, rotation: 180, crop: null });
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
});

test("ImageProcessor: crop в нормализованных координатах после rotation", async () => {
  const source = await makeImage({ width: 200, height: 100 });
  const result = await processor.process({
    buffer: source,
    rotation: 90,
    crop: { x: 0, y: 0, width: 1, height: 0.5 },
  });
  assert.equal(result.width, 100);
  assert.equal(result.height, 100);
});

test("ImageProcessor: crop за границами изображения отклоняется", async () => {
  const source = await makeImage({ width: 200, height: 100 });
  await assert.rejects(
    processor.process({
      buffer: source,
      rotation: 0,
      crop: { x: 0.5, y: 0, width: 0.8, height: 0.5 },
    }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
});

test("ImageProcessor: повреждённый файл отклоняется как CORRUPTED_FILE", async () => {
  await assert.rejects(
    processor.process({ buffer: Buffer.from("not an image"), rotation: 0, crop: null }),
    (error: unknown) => error instanceof AppError && error.code === "CORRUPTED_FILE"
  );
});

test("ImageProcessor: sha256 стабилен и соответствует содержимому", async () => {
  const source = await makeImage({ format: "png" });
  const first = await processor.process({ buffer: source, rotation: 0, crop: null });
  const second = await processor.process({ buffer: source, rotation: 0, crop: null });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.sha256.length, 64);
});
