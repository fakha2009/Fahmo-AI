import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { PreferencesService } from "../../src/modules/preferences/application/preferences-service";
import type {
  PreferencesCreateInput,
  PreferencesRecord,
  PreferencesRepository,
  PreferencesUpdatePatch,
} from "../../src/modules/preferences/application/preferences-repository";
import type { RevisionedUpdateResult } from "../../src/modules/versioning/domain/concurrency";

class InMemoryPreferencesRepository implements PreferencesRepository {
  private records = new Map<string, PreferencesRecord>();

  async getForOwner(sessionId: string | null, userId: string | null): Promise<PreferencesRecord | null> {
    if ((sessionId === null) === (userId === null)) {
      return null;
    }
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId && record.userId === userId) {
        return record;
      }
    }
    return null;
  }

  async create(input: PreferencesCreateInput): Promise<PreferencesRecord> {
    const now = new Date();
    const record: PreferencesRecord = { ...input, revision: 1, createdAt: now, updatedAt: now };
    this.records.set(input.id, record);
    return record;
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: PreferencesUpdatePatch
  ): Promise<RevisionedUpdateResult<PreferencesRecord>> {
    const record = this.records.get(id);
    if (record === undefined) {
      return { kind: "not_found" };
    }
    if (record.revision !== expectedRevision) {
      return { kind: "conflict", serverRevision: record.revision };
    }
    const updated: PreferencesRecord = { ...record, ...patch, revision: record.revision + 1, updatedAt: new Date() };
    this.records.set(id, updated);
    return { kind: "ok", record: updated };
  }
}

const OWNER = { sessionId: "session1", userId: null };
const INVALID_OWNER = { sessionId: null, userId: null };

test("getOrCreate: создаёт дефолты с revision 1 при первом обращении", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  const record = await service.getOrCreate(OWNER);
  assert.equal(record.revision, 1);
  assert.equal(record.interfaceLanguage, "ru");
  assert.equal(record.retentionMode, "history");
  assert.equal(record.sourcePreviewMode, "history");
  assert.equal(record.pushEnabled, false);
  assert.equal(record.sessionId, "session1");
});

test("getOrCreate: повторный вызов возвращает ту же запись", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  const first = await service.getOrCreate(OWNER);
  const second = await service.getOrCreate(OWNER);
  assert.equal(first.id, second.id);
  assert.equal(second.revision, 1);
});

test("getOrCreate: невалидный владелец (не XOR) → UNAUTHORIZED", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  await assert.rejects(
    () => service.getOrCreate(INVALID_OWNER),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHORIZED"
  );
  await assert.rejects(
    () => service.getOrCreate({ sessionId: "s", userId: "u" }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHORIZED"
  );
});

test("patch: успешное обновление с правильной ревизией", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  const created = await service.getOrCreate(OWNER);
  const updated = await service.patch(OWNER, created.revision, {
    theme: "dark",
    pushEnabled: true,
    retentionMode: "temporary",
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.theme, "dark");
  assert.equal(updated.pushEnabled, true);
  assert.equal(updated.retentionMode, "temporary");
  assert.equal(updated.interfaceLanguage, "ru");
});

test("patch: устаревшая revision → VERSION_CONFLICT с serverRevision", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  await service.getOrCreate(OWNER);
  await service.patch(OWNER, 1, { theme: "dark" });
  await assert.rejects(
    () => service.patch(OWNER, 1, { theme: "light" }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "VERSION_CONFLICT" &&
      error.params.serverRevision === 2
  );
});

test("patch: без существующих настроек → NOT_FOUND", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  await assert.rejects(
    () => service.patch(OWNER, 1, { theme: "light" }),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});

test("patch: пустой патч → VALIDATION_ERROR", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  await service.getOrCreate(OWNER);
  await assert.rejects(
    () => service.patch(OWNER, 1, {}),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
});

test("patch: чужой владелец не видит чужие настройки → NOT_FOUND", async () => {
  const service = new PreferencesService(new InMemoryPreferencesRepository());
  await service.getOrCreate(OWNER);
  await assert.rejects(
    () => service.patch({ sessionId: "other", userId: null }, 1, { theme: "dark" }),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});
