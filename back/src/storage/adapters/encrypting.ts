import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { Readable as ReadableStream } from "node:stream";
import { streamToBuffer } from "../../shared/utils/stream";
import type {
  PutObjectInput,
  StoragePort,
  StoredObject,
} from "../contracts/storage-port";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class StorageDecryptionError extends Error {
  constructor(public readonly key: string, cause: unknown) {
    super(`storage decryption failed: ${key}`);
    this.name = "StorageDecryptionError";
    this.cause = cause;
  }
}

// Декоратор: шифрует контент объектов под указанными префиксами (AES-256-GCM).
// Ключ выводится из секрета через SHA-256. Файл: [iv][authTag][ciphertext].
export class EncryptingStorageAdapter implements StoragePort {
  private readonly key: Buffer;

  constructor(
    private readonly inner: StoragePort,
    secret: string,
    private readonly encryptedPrefixes: readonly string[] = ["previews/"]
  ) {
    this.key = createHash("sha256").update(secret).digest();
  }

  private shouldEncrypt(key: string): boolean {
    return this.encryptedPrefixes.some((prefix) => key.startsWith(prefix));
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    if (!this.shouldEncrypt(input.key)) {
      return this.inner.put(input);
    }
    const plain = await streamToBuffer(input.body);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    return this.inner.put({
      ...input,
      body: Readable.from(encrypted),
    });
  }

  async get(key: string): Promise<ReadableStream> {
    const stream = await this.inner.get(key);
    if (!this.shouldEncrypt(key)) {
      return stream;
    }
    const raw = await streamToBuffer(stream);
    return Readable.from(this.decrypt(key, raw));
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    return this.inner.list(prefix);
  }

  private decrypt(key: string, raw: Buffer): Buffer {
    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new StorageDecryptionError(key, new Error("buffer too short"));
    }
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const data = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (error) {
      throw new StorageDecryptionError(key, error);
    }
  }
}
