import type { Readable } from "node:stream";

export interface StoredObject {
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: Date | null;
}

export interface PutObjectInput {
  key: string;
  contentType: string;
  body: Readable;
  expiresAt?: Date | null;
}

export class StorageObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}

export class InvalidStorageKeyError extends Error {
  constructor(public readonly key: string) {
    super(`invalid storage key: ${key}`);
    this.name = "InvalidStorageKeyError";
  }
}

const SAFE_KEY_PATTERN = /^[A-Za-z0-9._/-]{1,256}$/;

export function assertSafeStorageKey(key: string): void {
  if (!SAFE_KEY_PATTERN.test(key) || key.includes("..")) {
    throw new InvalidStorageKeyError(key);
  }
}

export interface StoragePort {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}
