import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { LocalStorageAdapter } from "../../src/storage/adapters/local";
import {
  EncryptingStorageAdapter,
  StorageDecryptionError,
} from "../../src/storage/adapters/encrypting";
import { streamToBuffer } from "../../src/shared/utils/stream";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function makeStorage() {
  const root = mkdtempSync(path.join(tmpdir(), "fahmo-enc-"));
  const local = new LocalStorageAdapter(root);
  const encrypted = new EncryptingStorageAdapter(local, "test-encryption-secret-32-chars-xxxxx");
  return { local, encrypted, root };
}

test("EncryptingStorage: контент под префиксом previews/ шифруется на диске", async () => {
  const { encrypted, root } = makeStorage();
  try {
    const plain = Buffer.concat([JPEG_MAGIC, Buffer.from("jpeg-body")]);
    await encrypted.put({
      key: "previews/abc123.jpeg",
      contentType: "image/jpeg",
      body: Readable.from(plain),
      expiresAt: null,
    });
    const raw = readFileSync(path.join(root, "previews", "abc123.jpeg"));
    assert.equal(raw.includes(JPEG_MAGIC), false, "сырые JPEG-байты не должны быть на диске");
    const roundTrip = await streamToBuffer(await encrypted.get("previews/abc123.jpeg"));
    assert.deepEqual(roundTrip, plain);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("EncryptingStorage: объекты вне префикса не шифруются", async () => {
  const { encrypted, root } = makeStorage();
  try {
    const plain = Buffer.from("plain-data");
    await encrypted.put({
      key: "staging/processed/1.jpg",
      contentType: "image/jpeg",
      body: Readable.from(plain),
      expiresAt: null,
    });
    const raw = readFileSync(path.join(root, "staging", "processed", "1.jpg"));
    assert.deepEqual(raw, plain);
    assert.deepEqual(await streamToBuffer(await encrypted.get("staging/processed/1.jpg")), plain);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("EncryptingStorage: повреждённый ciphertext → StorageDecryptionError", async () => {
  const { encrypted, root } = makeStorage();
  try {
    await encrypted.put({
      key: "previews/abc123.jpeg",
      contentType: "image/jpeg",
      body: Readable.from(Buffer.from("secret-payload")),
      expiresAt: null,
    });
    const filePath = path.join(root, "previews", "abc123.jpeg");
    const corrupted = Buffer.concat([readFileSync(filePath), Buffer.from("tampered")]);
    writeFileSync(filePath, corrupted);
    await assert.rejects(
      () => encrypted.get("previews/abc123.jpeg"),
      (error: unknown) => error instanceof StorageDecryptionError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("EncryptingStorage: delete и list прозрачны", async () => {
  const { encrypted, root } = makeStorage();
  try {
    await encrypted.put({
      key: "previews/1.jpeg",
      contentType: "image/jpeg",
      body: Readable.from(Buffer.from("data")),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const listed = await encrypted.list("previews/");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.key, "previews/1.jpeg");
    assert.equal(listed[0]?.expiresAt?.toISOString(), "2027-01-01T00:00:00.000Z");
    await encrypted.delete("previews/1.jpeg");
    assert.equal((await encrypted.list("previews/")).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
