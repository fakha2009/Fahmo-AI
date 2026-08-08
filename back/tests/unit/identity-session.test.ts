import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { hashSessionToken } from "../../src/modules/identity/domain/session";
import { SessionService } from "../../src/modules/identity/application/session-service";
import type {
  SessionRecord,
  SessionRepository,
} from "../../src/modules/identity/application/session-repository";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

class InMemorySessionRepository implements SessionRepository {
  private records = new Map<string, SessionRecord>();

  async create(input: { id: string; tokenHash: string; expiresAt: Date }): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: input.id,
      tokenHash: input.tokenHash,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.records.set(input.id, record);
    return record;
  }

  async getByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) {
        return record;
      }
    }
    return null;
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async updateLastSeen(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record !== undefined) {
      record.lastSeenAt = at;
    }
  }

  async revoke(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record !== undefined) {
      record.revokedAt = at;
    }
  }
}

function build(now = new Date("2026-01-01T00:00:00Z")) {
  const repository = new InMemorySessionRepository();
  const service = new SessionService(repository, { ttlMs: TTL_MS }, () => now);
  return { repository, service, now };
}

function expectCode(error: unknown, code: string): void {
  assert.ok(error instanceof AppError, "ожидался AppError");
  assert.equal(error.code, code);
}

test("SessionService: create выдаёт opaque-токен и хранит только хэш", async () => {
  const { service, repository } = build();
  const issued = await service.create();
  assert.match(issued.token, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(issued.session.revokedAt, null);
  const byHash = await repository.getByTokenHash(hashSessionToken(issued.token));
  assert.notEqual(byHash, null);
  const byToken = await repository.getByTokenHash(issued.token);
  assert.equal(byToken, null, "сырой токен не хранится");
});

test("SessionService: create вычисляет expiresAt по TTL", async () => {
  const { service } = build(new Date("2026-01-01T00:00:00Z"));
  const issued = await service.create();
  assert.equal(
    issued.session.expiresAt.getTime(),
    new Date("2026-01-01T00:00:00Z").getTime() + TTL_MS
  );
});

test("SessionService: validate возвращает сессию и обновляет lastSeen", async () => {
  const { service, repository } = build();
  const issued = await service.create();
  const later = new Date("2026-01-02T00:00:00Z");
  const validated = await new SessionService(
    repository,
    { ttlMs: TTL_MS },
    () => later
  ).validate(issued.token);
  assert.equal(validated.id, issued.session.id);
  assert.equal((await repository.get(issued.session.id))?.lastSeenAt.getTime(), later.getTime());
});

test("SessionService: validate истёкшей сессии → SESSION_EXPIRED", async () => {
  const { service, repository } = build(new Date("2026-01-01T00:00:00Z"));
  const issued = await service.create();
  const expired = new Date(issued.session.expiresAt.getTime() + 1000);
  const svc = new SessionService(repository, { ttlMs: TTL_MS }, () => expired);
  await assert.rejects(() => svc.validate(issued.token), (error: unknown) => {
    expectCode(error, "SESSION_EXPIRED");
    return true;
  });
});

test("SessionService: validate отозванной сессии → UNAUTHORIZED", async () => {
  const { service } = build();
  const issued = await service.create();
  await service.revoke(issued.token);
  await assert.rejects(() => service.validate(issued.token), (error: unknown) => {
    expectCode(error, "UNAUTHORIZED");
    return true;
  });
});

test("SessionService: validate неизвестного/невалидного токена → UNAUTHORIZED", async () => {
  const { service } = build();
  await assert.rejects(() => service.validate("unknown-token-123456"), (error: unknown) => {
    expectCode(error, "UNAUTHORIZED");
    return true;
  });
  await assert.rejects(() => service.validate("короткий"), (error: unknown) => {
    expectCode(error, "UNAUTHORIZED");
    return true;
  });
});

test("SessionService: rotate отзывает старую и выдаёт новую", async () => {
  const { service } = build();
  const first = await service.create();
  const rotated = await service.rotate(first.token);
  assert.notEqual(rotated.token, first.token);
  assert.equal(rotated.session.id !== first.session.id, true);
  await assert.rejects(() => service.validate(first.token), (error: unknown) => {
    expectCode(error, "UNAUTHORIZED");
    return true;
  });
  const validated = await service.validate(rotated.token);
  assert.equal(validated.id, rotated.session.id);
});

test("SessionService: revoke идемпотентен", async () => {
  const { service } = build();
  const issued = await service.create();
  await service.revoke(issued.token);
  await service.revoke(issued.token);
  await service.revoke("unknown-token-1234567890abcdefgh");
});
