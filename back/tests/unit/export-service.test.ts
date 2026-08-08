import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { ExportService } from "../../src/modules/exports/application/export-service";
import type {
  ExportJobCreateInput,
  ExportJobRecord,
  ExportJobRepository,
} from "../../src/modules/exports/application/export-repository";
import type { ExportDataPorts } from "../../src/modules/exports/application/export-runners";
import type { StoragePort, StoredObject } from "../../src/storage/contracts/storage-port";

const NOW = new Date("2026-08-06T10:00:00.000Z");
const TTL_MS = 24 * 60 * 60 * 1000;

class InMemoryExportJobRepository implements ExportJobRepository {
  records = new Map<string, ExportJobRecord>();

  async create(input: ExportJobCreateInput): Promise<ExportJobRecord> {
    const record: ExportJobRecord = {
      id: input.id,
      kind: input.kind,
      status: "queued",
      analysisId: input.analysisId,
      sessionId: input.sessionId,
      userId: input.userId,
      storageKey: null,
      payload: input.payload,
      errorCode: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      expiresAt: input.expiresAt,
    };
    this.records.set(input.id, record);
    return record;
  }

  async get(id: string): Promise<ExportJobRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listForOwner(
    sessionId: string | null,
    userId: string | null,
    limit: number
  ): Promise<ExportJobRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.sessionId === sessionId && r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async claimNext(now: Date): Promise<ExportJobRecord | null> {
    const candidate = [...this.records.values()]
      .filter((r) => r.status === "queued" && r.expiresAt.getTime() > now.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (candidate === undefined) {
      return null;
    }
    this.records.set(candidate.id, { ...candidate, status: "running", updatedAt: now });
    return this.records.get(candidate.id)!;
  }

  async complete(id: string, storageKey: string, now: Date): Promise<ExportJobRecord | null> {
    const record = this.records.get(id);
    if (record === undefined || record.status !== "running") {
      return null;
    }
    const updated: ExportJobRecord = {
      ...record,
      status: "done",
      storageKey,
      completedAt: now,
      updatedAt: now,
    };
    this.records.set(id, updated);
    return updated;
  }

  async fail(id: string, errorCode: string): Promise<ExportJobRecord | null> {
    const record = this.records.get(id);
    if (record === undefined || record.status !== "running") {
      return null;
    }
    const updated: ExportJobRecord = { ...record, status: "failed", errorCode, updatedAt: NOW };
    this.records.set(id, updated);
    return updated;
  }

  async listExpired(now: Date): Promise<ExportJobRecord[]> {
    return [...this.records.values()].filter(
      (r) => (r.status === "done" || r.status === "failed") && r.expiresAt.getTime() < now.getTime()
    );
  }

  async deleteExpired(now: Date): Promise<number> {
    const expired = await this.listExpired(now);
    for (const record of expired) {
      this.records.delete(record.id);
    }
    return expired.length;
  }
}

class FakeStorage implements StoragePort {
  objects = new Map<string, Buffer>();
  deletedKeys: string[] = [];

  async put(input: { key: string; contentType: string; body: Readable; expiresAt?: Date | null }): Promise<StoredObject> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    this.objects.set(input.key, body);
    return {
      key: input.key,
      contentType: input.contentType,
      sizeBytes: body.length,
      sha256: "x",
      expiresAt: input.expiresAt ?? null,
    };
  }

  async get(key: string): Promise<Readable> {
    const body = this.objects.get(key);
    if (body === undefined) {
      throw new Error("not found");
    }
    return Readable.from(body);
  }

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }

  async list(_prefix: string): Promise<StoredObject[]> {
    return [];
  }
}

function analysisRecord(overrides: Partial<{ id: string; sessionId: string | null }> = {}) {
  return {
    id: overrides.id ?? "analysis1",
    sessionId: overrides.sessionId === undefined ? "session1" : overrides.sessionId,
    userId: null,
    status: "completed",
    stage: "completed",
    progress: 100,
    sourceType: "text",
    documentType: "contract",
    outputLanguage: "ru",
    result: {
      version: "1.0",
      title: "Договор",
      documentType: "contract",
      detectedLanguages: ["ru"],
      outputLanguage: "ru",
      summary: "Сводка",
      simpleExplanation: "Просто",
      tasks: [],
      dates: [],
      amounts: [],
      locations: [],
      contacts: [],
      requiredDocuments: [],
      links: [],
      warnings: [],
      clarificationQuestions: [],
      overallConfidence: "high",
    },
    detectedLanguages: ["ru"],
    provider: "gemini",
    model: "x",
    errorCode: null,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    expiresAt: null,
  } as const;
}

function taskRecord(id: string, sessionId: string | null = "session1") {
  return {
    id,
    analysisId: "analysis1",
    sessionId,
    userId: null,
    title: "Оплатить",
    description: null,
    simpleTitle: "Платите",
    simpleDescription: null,
    assigneeText: null,
    priority: "high",
    status: "pending",
    dueAt: new Date("2026-09-05T00:00:00.000Z"),
    timezone: null,
    sourceData: null,
    aiOriginal: null,
    clientMutationId: null,
    revision: 1,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  } as const;
}

function makePorts(): ExportDataPorts {
  return {
    analysisRepository: {
      get: async (id: string) => {
        if (id !== "analysis1") {
          return null;
        }
        return analysisRecord() as never;
      },
      listByOwner: async () => [analysisRecord()] as never,
    },
    taskRepository: {
      get: async (id: string) => (id === "task1" ? (taskRecord(id) as never) : null),
      listByAnalysis: async () => [taskRecord("task1")] as never,
      listByOwner: async () => [taskRecord("task1")] as never,
    },
    reminderRepository: {
      listByTaskIds: async (taskIds: string[]) =>
        taskIds.map((taskId) => ({
          id: `rem-${taskId}`,
          taskId,
          scheduledAt: new Date("2026-09-04T00:00:00.000Z"),
          timezone: "Asia/Dushanbe",
          channel: "in_app",
          status: "scheduled",
          idempotencyKey: null,
          revision: 1,
          attemptCount: 0,
          lastError: null,
          sentAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        })) as never,
    },
    versionRepository: {
      listForAnalysis: async () => [] as never,
    },
    preferencesRepository: {
      getForOwner: async () => null,
    },
  };
}

function makeService(overrides: { now?: Date; id?: string } = {}) {
  const repository = new InMemoryExportJobRepository();
  const storage = new FakeStorage();
  const service = new ExportService(
    repository,
    makePorts(),
    storage,
    undefined,
    undefined,
    () => overrides.now ?? NOW,
    () => overrides.id ?? "exportjob1"
  );
  return { service, repository, storage };
}

const OWNER = { sessionId: "session1", userId: null };

test("createJob: PDF создаёт QUEUED-джоб с TTL 24h", async () => {
  const { service } = makeService();
  const job = await service.createJob(OWNER, { kind: "pdf", analysisId: "analysis1" });
  assert.equal(job.kind, "pdf");
  assert.equal(job.status, "queued");
  assert.equal(job.analysisId, "analysis1");
  assert.equal(job.expiresAt.getTime(), NOW.getTime() + TTL_MS);
});

test("createJob: ICS сохраняет taskIds в payload", async () => {
  const { service } = makeService();
  const job = await service.createJob(OWNER, { kind: "ics", taskIds: ["task1"] });
  assert.equal(job.kind, "ics");
  assert.equal((job.payload as { taskIds: string[] }).taskIds[0], "task1");
});

test("createJob: ICS отклоняет прошедший срок", async () => {
  const { service } = makeService({ now: new Date("2026-10-01T10:00:00.000Z") });
  await assert.rejects(
    service.createJob(OWNER, { kind: "ics", taskIds: ["task1"] }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR"
  );
});

test("createJob: PDF без analysisId → VALIDATION_ERROR", async () => {
  const { service } = makeService();
  await assert.rejects(service.createJob(OWNER, { kind: "pdf" }), (error: AppError) => {
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
});

test("createJob: ICS без taskIds → VALIDATION_ERROR", async () => {
  const { service } = makeService();
  await assert.rejects(service.createJob(OWNER, { kind: "ics" }), (error: AppError) => {
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
});

test("createJob: чужой анализ → NOT_FOUND", async () => {
  const { service } = makeService();
  await assert.rejects(
    service.createJob({ sessionId: "session2", userId: null }, { kind: "pdf", analysisId: "analysis1" }),
    (error: AppError) => error.code === "NOT_FOUND"
  );
});

test("createJob: невалидный владелец → UNAUTHORIZED", async () => {
  const { service } = makeService();
  await assert.rejects(service.createJob({ sessionId: null, userId: null }, { kind: "data" }), (error: AppError) => {
    assert.equal(error.code, "UNAUTHORIZED");
    return true;
  });
});

test("runNext: PDF генерирует артефакт и переводит в DONE", async () => {
  const { service, storage } = makeService();
  await service.createJob(OWNER, { kind: "pdf", analysisId: "analysis1" });
  const done = await service.runNext();
  assert.ok(done !== null);
  assert.equal(done.status, "done");
  assert.ok(done.storageKey !== null);
  assert.ok(done.storageKey.startsWith("exports/session1/exportjob1.pdf"));
  assert.ok(storage.objects.has(done.storageKey));
});

test("runNext: ICS генерирует календарь с событиями", async () => {
  const { service, storage } = makeService();
  await service.createJob(OWNER, { kind: "ics", taskIds: ["task1"] });
  const done = await service.runNext();
  assert.equal(done?.status, "done");
  const body = storage.objects.get(done!.storageKey!)!;
  assert.ok(body.toString("utf8").includes("BEGIN:VEVENT"));
  assert.ok(body.toString("utf8").includes("DTSTART;VALUE=DATE:20260905"));
  assert.ok(body.toString("utf8").includes("TRIGGER:-PT1440M"));
});

test("runNext: при ошибке генерации → FAILED с EXPORT_GENERATION_FAILED", async () => {
  const { service, repository } = makeService();
  await service.createJob(OWNER, { kind: "pdf", analysisId: "analysis1" });
  repository.records.get("exportjob1")!.analysisId = "missing";
  const failed = await service.runNext();
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "EXPORT_GENERATION_FAILED");
});

test("artifactFor: queued → EXPORT_NOT_READY", async () => {
  const { service } = makeService();
  await service.createJob(OWNER, { kind: "data" });
  await assert.rejects(service.artifactFor(OWNER, "exportjob1"), (error: AppError) => {
    assert.equal(error.code, "EXPORT_NOT_READY");
    return true;
  });
});

test("artifactFor: чужой job → NOT_FOUND", async () => {
  const { service } = makeService();
  await service.createJob(OWNER, { kind: "data" });
  await assert.rejects(
    service.artifactFor({ sessionId: "session2", userId: null }, "exportjob1"),
    (error: AppError) => error.code === "NOT_FOUND"
  );
});

test("artifactFor: done → stream с содержимым", async () => {
  const { service } = makeService();
  await service.createJob(OWNER, { kind: "data" });
  await service.runNext();
  const result = await service.artifactFor(OWNER, "exportjob1");
  assert.equal(result.job.status, "done");
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  assert.ok(text.includes("fahmo-ai"));
  assert.ok(text.includes("schemaVersion"));
});

test("cleanup: удаляет истёкшие джобы и файлы из storage", async () => {
  const { service, repository, storage } = makeService();
  await service.createJob(OWNER, { kind: "data" });
  await service.runNext();
  const deleted = await service.cleanup(new Date(NOW.getTime() + TTL_MS + 1000));
  assert.equal(deleted, 1);
  assert.equal(storage.deletedKeys.length, 1);
  assert.equal(repository.records.size, 0);
});

test("getJob: истёкший джоб не возвращается", async () => {
  const { service, repository } = makeService();
  await service.createJob(OWNER, { kind: "data" });
  repository.records.get("exportjob1")!.expiresAt = new Date(NOW.getTime() - 1000);
  const job = await service.getJob(OWNER, "exportjob1");
  assert.equal(job, null);
});

test("listJobs: сортировка по created_at desc", async () => {
  const { service, repository } = makeService({ id: "exportjob1" });
  await service.createJob(OWNER, { kind: "data" });
  const later = new Date(NOW.getTime() + 1000);
  const second = await repository.create({
    id: "exportjob2",
    kind: "data",
    analysisId: null,
    sessionId: "session1",
    userId: null,
    payload: null,
    expiresAt: new Date(later.getTime() + TTL_MS),
  });
  repository.records.get(second.id)!.createdAt = later;
  const jobs = await service.listJobs(OWNER, 10);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.id, "exportjob2");
});
