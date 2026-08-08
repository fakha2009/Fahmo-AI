import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorageAdapter } from "../../src/storage/adapters/local";
import { SourcePreviewService } from "../../src/modules/ingestion/application/source-preview";
import { AppError } from "../../src/shared/errors";
import { sha256Hex } from "../../src/shared/utils/hash";
import type { PreviewPolicy } from "../../src/modules/ingestion/domain/types";

function withPreview(
  run: (service: SourcePreviewService, storage: LocalStorageAdapter) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "fahmo-preview-"));
  const storage = new LocalStorageAdapter(root);
  const service = new SourcePreviewService(storage);
  return run(service, storage).finally(() => rmSync(root, { recursive: true, force: true }));
}

const historyPolicy: PreviewPolicy = { mode: "history", ttl: { days: 30 } };
const temporaryPolicy: PreviewPolicy = { mode: "temporary", ttl: { hours: 24 } };

test("SourcePreviewService: mode=no_preview не сохраняет объект", () =>
  withPreview(async (service, storage) => {
    const asset = await service.create({
      image: { buffer: Buffer.from("img"), width: 10, height: 20, sha256: "abc" },
      page: { clientPageId: "p1", inputIndex: 0, pageNumber: 1 },
      policy: { mode: "no_preview", ttl: null },
    });
    assert.equal(asset, null);
    assert.equal((await storage.list("previews/")).length, 0);
  }));

test("SourcePreviewService: history сохраняет jpeg-превью с TTL", () =>
  withPreview(async (service, storage) => {
    const image = { buffer: Buffer.from("preview-bytes"), width: 100, height: 200, sha256: sha256Hex(Buffer.from("preview-bytes")) };
    const asset = await service.create({
      image,
      page: { clientPageId: "p1", inputIndex: 0, pageNumber: 1 },
      policy: historyPolicy,
    });
    assert.ok(asset !== null);
    assert.equal(asset.mimeType, "image/jpeg");
    assert.equal(asset.clientPageId, "p1");
    assert.equal(asset.sha256, image.sha256);
    assert.equal(asset.expiresAt.getTime() - asset.createdAt.getTime(), 30 * 24 * 60 * 60 * 1000);
    const objects = await storage.list("previews/");
    assert.equal(objects.length, 1);
    assert.equal(objects[0]?.key, asset.storageKey);
  }));

test("SourcePreviewService: temporary использует TTL 24 часа", () =>
  withPreview(async (service) => {
    const asset = await service.create({
      image: { buffer: Buffer.from("x"), width: 1, height: 1, sha256: "abc" },
      page: { clientPageId: "p1", inputIndex: 0, pageNumber: 1 },
      policy: temporaryPolicy,
    });
    assert.ok(asset !== null);
    assert.equal(asset.expiresAt.getTime() - asset.createdAt.getTime(), 24 * 60 * 60 * 1000);
  }));

test("SourcePreviewService: режим без TTL отклоняется", () =>
  withPreview(async (service) => {
    await assert.rejects(
      service.create({
        image: { buffer: Buffer.from("x"), width: 1, height: 1, sha256: "abc" },
        page: { clientPageId: "p1", inputIndex: 0, pageNumber: 1 },
        policy: { mode: "history", ttl: null },
      }),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
    );
  }));

test("SourcePreviewService: remove удаляет объект", () =>
  withPreview(async (service, storage) => {
    const asset = await service.create({
      image: { buffer: Buffer.from("x"), width: 1, height: 1, sha256: "abc" },
      page: { clientPageId: "p1", inputIndex: 0, pageNumber: 1 },
      policy: historyPolicy,
    });
    assert.ok(asset !== null);
    await service.remove(asset);
    assert.equal((await storage.list("previews/")).length, 0);
  }));
