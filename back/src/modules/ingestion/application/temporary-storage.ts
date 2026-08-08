import type { Readable } from "node:stream";
import { Readable as ReadableStream } from "node:stream";
import { randomHex } from "../../../shared/utils/hash";
import type { StoragePort } from "../../../storage/contracts/storage-port";
import type { StagedObject } from "../domain/types";

export interface StageInput {
  prefix?: string;
  contentType: string;
  body: Readable;
  expiresAt?: Date | null;
}

export class TemporaryStorageService {
  constructor(
    private readonly storage: StoragePort,
    private readonly bucket = "staging"
  ) {}

  private newKey(prefix: string): string {
    return `${this.bucket}/${prefix}/${randomHex()}`;
  }

  async stage(input: StageInput): Promise<StagedObject> {
    const stored = await this.storage.put({
      key: this.newKey(input.prefix ?? "files"),
      contentType: input.contentType,
      body: input.body,
      expiresAt: input.expiresAt ?? null,
    });
    return {
      key: stored.key,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      expiresAt: stored.expiresAt,
    };
  }

  async stageBuffer(input: {
    prefix?: string;
    contentType: string;
    buffer: Buffer;
    expiresAt?: Date | null;
  }): Promise<StagedObject> {
    return this.stage({
      prefix: input.prefix,
      contentType: input.contentType,
      body: ReadableStream.from(input.buffer),
      expiresAt: input.expiresAt,
    });
  }

  open(key: string): Promise<Readable> {
    return this.storage.get(key);
  }

  remove(key: string): Promise<void> {
    return this.storage.delete(key);
  }

  async cleanupExpired(now: Date = new Date()): Promise<number> {
    const objects = await this.storage.list(`${this.bucket}/`);
    let removed = 0;
    for (const object of objects) {
      if (object.expiresAt !== null && object.expiresAt.getTime() <= now.getTime()) {
        await this.storage.delete(object.key);
        removed += 1;
      }
    }
    return removed;
  }
}
