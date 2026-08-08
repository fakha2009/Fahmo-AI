import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { LocalStorageAdapter } from "../../src/storage/adapters/local";
import { StorageObjectNotFoundError } from "../../src/storage/contracts/storage-port";
import { TemporaryStorageService } from "../../src/modules/ingestion/application/temporary-storage";
import { sha256Hex } from "../../src/shared/utils/hash";
import { streamToBuffer } from "../../src/shared/utils/stream";

function withStorage(run: (service: TemporaryStorageService, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "fahmo-storage-"));
  const storage = new LocalStorageAdapter(root);
  const service = new TemporaryStorageService(storage);
  return run(service, root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("TemporaryStorageService: stage вычисляет SHA-256 потоково и возвращает метаданные", () =>
  withStorage(async (service) => {
    const content = Buffer.from("payload-data-for-hash");
    const staged = await service.stage({
      contentType: "text/plain",
      body: Readable.from(content),
    });
    assert.equal(staged.sha256, sha256Hex(content));
    assert.equal(staged.sizeBytes, content.length);
    assert.ok(staged.key.startsWith("staging/"));
  }));

test("TemporaryStorageService: open возвращает те же байты", () =>
  withStorage(async (service) => {
    const content = Buffer.from("round-trip");
    const staged = await service.stage({
      contentType: "text/plain",
      body: Readable.from(content),
    });
    const read = await streamToBuffer(await service.open(staged.key));
    assert.deepEqual(read, content);
  }));

test("TemporaryStorageService: remove удаляет объект, повторное open бросает NotFound", () =>
  withStorage(async (service) => {
    const staged = await service.stage({
      contentType: "text/plain",
      body: Readable.from(Buffer.from("temp")),
    });
    await service.remove(staged.key);
    await assert.rejects(service.open(staged.key), StorageObjectNotFoundError);
  }));

test("TemporaryStorageService: cleanupExpired удаляет только истёкшие объекты", () =>
  withStorage(async (service) => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const expired = await service.stage({
      contentType: "text/plain",
      body: Readable.from(Buffer.from("expired")),
      expiresAt: past,
    });
    const alive = await service.stage({
      contentType: "text/plain",
      body: Readable.from(Buffer.from("alive")),
      expiresAt: future,
    });
    const removed = await service.cleanupExpired(new Date());
    assert.equal(removed, 1);
    await assert.rejects(service.open(expired.key), StorageObjectNotFoundError);
    const aliveBytes = await streamToBuffer(await service.open(alive.key));
    assert.equal(aliveBytes.toString("utf8"), "alive");
  }));

test("TemporaryStorageService: объект без TTL не удаляется cleanup", () =>
  withStorage(async (service) => {
    await service.stage({
      contentType: "text/plain",
      body: Readable.from(Buffer.from("no-ttl")),
    });
    const removed = await service.cleanupExpired(new Date());
    assert.equal(removed, 0);
  }));
