import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import {
  IdempotencyService,
  hashRequest,
} from "../../src/modules/idempotency/application/idempotency-service";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  StoredIdempotencyRecord,
} from "../../src/modules/idempotency/application/idempotency-repository";

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private records = new Map<string, IdempotencyRecord>();

  async create(input: StoredIdempotencyRecord): Promise<IdempotencyRecord> {
    const key = `${input.actorKey}\u0000${input.idempotencyKey}`;
    const existing = this.records.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const record: IdempotencyRecord = {
      id: `idem-${this.records.size + 1}`,
      actorKey: input.actorKey,
      idempotencyKey: input.idempotencyKey,
      endpoint: input.endpoint,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
    };
    this.records.set(key, record);
    return record;
  }

  async get(actorKey: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    return this.records.get(`${actorKey}\u0000${idempotencyKey}`) ?? null;
  }

  async update(
    actorKey: string,
    idempotencyKey: string,
    responseStatus: number,
    responseBody: unknown
  ): Promise<IdempotencyRecord | null> {
    const key = `${actorKey}\u0000${idempotencyKey}`;
    const existing = this.records.get(key);
    if (existing === undefined) {
      return null;
    }
    const updated: IdempotencyRecord = { ...existing, responseStatus, responseBody };
    this.records.set(key, updated);
    return updated;
  }

  async deleteExpired(now: Date): Promise<number> {
    let count = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt.getTime() < now.getTime()) {
        this.records.delete(key);
        count += 1;
      }
    }
    return count;
  }
}

test("IdempotencyService: первый вызов isNew, второй — replay того же ответа", async () => {
  const service = new IdempotencyService(new InMemoryIdempotencyRepository());
  const first = await service.acquire("actor-1", "key-0000001", "POST /tasks", "hash-1");
  assert.equal(first.isNew, true);
  await service.complete("actor-1", "key-0000001", 201, { id: "task-1" });

  const replay = await service.acquire("actor-1", "key-0000001", "POST /tasks", "hash-1");
  assert.equal(replay.isNew, false);
  assert.ok(replay.record !== null);
  assert.equal(replay.record.responseStatus, 201);
});

test("IdempotencyService: тот же ключ с другим телом → IDEMPOTENCY_CONFLICT", async () => {
  const service = new IdempotencyService(new InMemoryIdempotencyRepository());
  await service.acquire("actor-1", "key-0000002", "POST /tasks", "hash-1");
  await assert.rejects(
    () => service.acquire("actor-1", "key-0000002", "POST /tasks", "hash-DIFFERENT"),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("IdempotencyService: ключи разных акторов не пересекаются", async () => {
  const service = new IdempotencyService(new InMemoryIdempotencyRepository());
  await service.acquire("actor-1", "key-0000003", "POST /tasks", "hash-1");
  const other = await service.acquire("actor-2", "key-0000003", "POST /tasks", "hash-1");
  assert.equal(other.isNew, true);
});

test("IdempotencyService: истёкшие записи удаляются cleanupExpired", async () => {
  const repository = new InMemoryIdempotencyRepository();
  const fixedNow = new Date("2026-01-01T00:00:00Z");
  const service = new IdempotencyService(repository, { ttlMs: 1000 }, () => fixedNow);
  await service.acquire("actor-1", "key-0000004", "POST /tasks", "hash-1");
  assert.equal(await service.cleanupExpired(), 0);
  const later = new Date("2026-01-01T00:00:02Z");
  const serviceLater = new IdempotencyService(repository, { ttlMs: 1000 }, () => later);
  assert.equal(await serviceLater.cleanupExpired(), 1);
});

test("hashRequest: детерминированный и чувствителен к изменениям", () => {
  const hash = hashRequest("POST", "/tasks", { title: "x" });
  assert.equal(hash.length, 64);
  assert.equal(hash, hashRequest("POST", "/tasks", { title: "x" }));
  assert.notEqual(hash, hashRequest("POST", "/tasks", { title: "y" }));
});
