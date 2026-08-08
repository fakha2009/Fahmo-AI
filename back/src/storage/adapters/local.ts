import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import {
  assertSafeStorageKey,
  InvalidStorageKeyError,
  StorageObjectNotFoundError,
  type PutObjectInput,
  type StoragePort,
  type StoredObject,
} from "../contracts/storage-port";

interface StoredObjectMeta {
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: string | null;
}

export class LocalStorageAdapter implements StoragePort {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  private objectPath(key: string): string {
    assertSafeStorageKey(key);
    return path.join(this.rootDir, ...key.split("/"));
  }

  private metaPath(key: string): string {
    return `${this.objectPath(key)}.meta.json`;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const objectPath = this.objectPath(input.key);
    mkdirSync(path.dirname(objectPath), { recursive: true });
    const hash = createHash("sha256");
    const hasher = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const sink = createWriteStream(objectPath);
    await pipeline(input.body, hasher, sink);
    const stat = statSync(objectPath);
    const sha256 = hash.digest("hex");
    const meta: StoredObjectMeta = {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: stat.size,
      sha256,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    };
    writeFileSync(this.metaPath(input.key), `${JSON.stringify(meta)}\n`);
    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: stat.size,
      sha256,
      expiresAt: input.expiresAt ?? null,
    };
  }

  async get(key: string): Promise<Readable> {
    const objectPath = this.objectPath(key);
    if (!existsSync(objectPath)) {
      throw new StorageObjectNotFoundError(key);
    }
    return createReadStream(objectPath);
  }

  async delete(key: string): Promise<void> {
    try {
      assertSafeStorageKey(key);
    } catch (error) {
      if (error instanceof InvalidStorageKeyError) {
        return;
      }
      throw error;
    }
    for (const file of [this.objectPath(key), this.metaPath(key)]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // ignore concurrent removal
      }
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    const walk = (dir: string, relative: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        const key = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(entryPath, key);
        } else if (entry.isFile() && !key.endsWith(".meta.json")) {
          if (prefix !== "" && !key.startsWith(prefix)) {
            continue;
          }
          const metaPath = `${entryPath}.meta.json`;
          if (!existsSync(metaPath)) {
            continue;
          }
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf8")) as StoredObjectMeta;
            objects.push({
              key: meta.key,
              contentType: meta.contentType,
              sizeBytes: meta.sizeBytes,
              sha256: meta.sha256,
              expiresAt: meta.expiresAt === null ? null : new Date(meta.expiresAt),
            });
          } catch {
            // skip objects without valid metadata
          }
        }
      }
    };
    walk(this.rootDir, "");
    return objects;
  }
}
