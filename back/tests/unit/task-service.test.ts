import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { TaskService } from "../../src/modules/tasks/application/task-service";
import type {
  TaskCreateInput,
  TaskCreateWithMutationResult,
  TaskRecord,
  TaskRepository,
  TaskUpdatePatch,
} from "../../src/modules/tasks/application/task-repository";
import type { RevisionedUpdateResult } from "../../src/modules/versioning/domain/concurrency";

class InMemoryTaskRepository implements TaskRepository {
  private records = new Map<string, TaskRecord>();

  async create(input: TaskCreateInput): Promise<TaskRecord> {
    const now = new Date();
    const record: TaskRecord = {
      ...input,
      completedAt: null,
      deletedAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(input.id, record);
    return record;
  }

  async createWithClientMutation(input: TaskCreateInput): Promise<TaskCreateWithMutationResult> {
    if (input.clientMutationId !== null) {
      for (const record of this.records.values()) {
        if (
          record.clientMutationId === input.clientMutationId &&
          record.sessionId === input.sessionId &&
          record.userId === input.userId
        ) {
          return { kind: "reused", record };
        }
      }
    }
    return { kind: "created", record: await this.create(input) };
  }

  async get(id: string): Promise<TaskRecord | null> {
    return this.records.get(id) ?? null;
  }

  async countByOwner(sessionId: string | null, userId: string | null): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.deletedAt === null && record.sessionId === sessionId && record.userId === userId) {
        count += 1;
      }
    }
    return count;
  }

  async listByAnalysis(analysisId: string): Promise<TaskRecord[]> {
    return [...this.records.values()].filter((record) => record.analysisId === analysisId);
  }

  async listByOwner(sessionId: string | null, userId: string | null): Promise<TaskRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.sessionId === sessionId && record.userId === userId
    );
  }

  async listActivePageByOwner(sessionId: string | null, userId: string | null, limit: number): Promise<TaskRecord[]> {
    return (await this.listByOwner(sessionId, userId))
      .filter((record) => record.deletedAt === null)
      .slice(0, limit);
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: TaskUpdatePatch
  ): Promise<RevisionedUpdateResult<TaskRecord>> {
    return this.mutate(id, expectedRevision, patch);
  }

  async complete(id: string, expectedRevision: number): Promise<RevisionedUpdateResult<TaskRecord>> {
    return this.mutate(id, expectedRevision, { status: "completed", completedAt: new Date() });
  }

  async remove(id: string, expectedRevision: number): Promise<RevisionedUpdateResult<TaskRecord>> {
    return this.mutate(id, expectedRevision, { deletedAt: new Date() });
  }

  private mutate(
    id: string,
    expectedRevision: number,
    patch: Partial<TaskRecord>
  ): RevisionedUpdateResult<TaskRecord> {
    const record = this.records.get(id);
    if (record === undefined || record.deletedAt !== null) {
      return { kind: "not_found" };
    }
    if (record.revision !== expectedRevision) {
      return { kind: "conflict", serverRevision: record.revision };
    }
    const updated: TaskRecord = {
      ...record,
      ...patch,
      revision: record.revision + 1,
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return { kind: "ok", record: updated };
  }
}

const OWNER = { sessionId: "s1", userId: null };

test("TaskService.create: создаёт задачу с revision 1", async () => {
  const service = new TaskService(new InMemoryTaskRepository());
  const task = await service.create(OWNER, {
    analysisId: null,
    title: "Оплатить счёт",
    description: null,
    simpleTitle: "Оплатить счёт",
    simpleDescription: null,
    assigneeText: null,
    priority: "high",
    status: "pending",
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
  });
  assert.equal(task.revision, 1);
  assert.equal(task.sessionId, "s1");
});

test("TaskService.create: повторный clientMutationId возвращает ту же задачу", async () => {
  const service = new TaskService(new InMemoryTaskRepository());
  const base = {
    analysisId: null,
    title: "Оплатить счёт",
    description: null,
    simpleTitle: "Оплатить счёт",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium" as const,
    status: "pending" as const,
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
  };
  const first = await service.create(OWNER, { ...base, clientMutationId: "mutation_0001" });
  const second = await service.create(OWNER, { ...base, clientMutationId: "mutation_0001" });
  assert.equal(first.id, second.id);
  assert.equal(second.revision, 1);
});

test("TaskService.patch: успех и VERSION_CONFLICT при устаревшей revision", async () => {
  const service = new TaskService(new InMemoryTaskRepository());
  const task = await service.create(OWNER, {
    analysisId: null,
    title: "Задача",
    description: null,
    simpleTitle: "Задача",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium",
    status: "pending",
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
  });
  const updated = await service.patch(OWNER, task.id, 1, { title: "Новая задача" });
  assert.equal(updated.revision, 2);
  assert.equal(updated.title, "Новая задача");
  await assert.rejects(
    () => service.patch(OWNER, task.id, 1, { title: "x" }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "VERSION_CONFLICT" &&
      error.params.serverRevision === 2
  );
});

test("TaskService: чужой владелец → NOT_FOUND, невалидный владелец → UNAUTHORIZED", async () => {
  const service = new TaskService(new InMemoryTaskRepository());
  const task = await service.create(OWNER, {
    analysisId: null,
    title: "Задача",
    description: null,
    simpleTitle: "Задача",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium",
    status: "pending",
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
  });
  assert.equal(await service.get({ sessionId: "other", userId: null }, task.id), null);
  await assert.rejects(
    () => service.patch({ sessionId: "other", userId: null }, task.id, 1, { title: "x" }),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND"
  );
  await assert.rejects(
    () => service.create({ sessionId: null, userId: null }, { title: "x", simpleTitle: "x", priority: "medium", status: "pending", analysisId: null, description: null, simpleDescription: null, assigneeText: null, dueAt: null, timezone: null, sourceData: null, aiOriginal: null }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHORIZED"
  );
});

test("TaskService.complete и remove: revision инкрементится, удалённая задача недоступна", async () => {
  const service = new TaskService(new InMemoryTaskRepository());
  const task = await service.create(OWNER, {
    analysisId: null,
    title: "Задача",
    description: null,
    simpleTitle: "Задача",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium",
    status: "pending",
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
  });
  const completed = await service.complete(OWNER, task.id, 1);
  assert.equal(completed.status, "completed");
  assert.equal(completed.revision, 2);
  assert.ok(completed.completedAt !== null);
  await service.remove(OWNER, task.id, 2);
  assert.equal(await service.get(OWNER, task.id), null);
});
