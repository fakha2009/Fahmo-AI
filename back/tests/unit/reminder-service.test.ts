import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { ReminderService } from "../../src/modules/reminders/application/reminder-service";
import type {
  ReminderCreateInput,
  ReminderDeleteResult,
  ReminderRecord,
  ReminderRepository,
  ReminderUpdatePatch,
} from "../../src/modules/reminders/application/reminder-repository";
import type { TaskRecord, TaskRepository } from "../../src/modules/tasks/application/task-repository";
import type { RevisionedUpdateResult } from "../../src/modules/versioning/domain/concurrency";

class InMemoryReminderRepository implements ReminderRepository {
  private records = new Map<string, ReminderRecord>();

  async create(input: ReminderCreateInput): Promise<ReminderRecord> {
    const now = new Date();
    const record: ReminderRecord = {
      id: input.id,
      taskId: input.taskId,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
      channel: input.channel,
      status: "scheduled",
      idempotencyKey: input.idempotencyKey,
      revision: 1,
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(input.id, record);
    return record;
  }

  async createWithIdempotencyKey(input: ReminderCreateInput): Promise<ReminderRecord> {
    if (input.idempotencyKey !== null) {
      for (const record of this.records.values()) {
        if (record.idempotencyKey === input.idempotencyKey) {
          return record;
        }
      }
    }
    return this.create(input);
  }

  async get(id: string): Promise<ReminderRecord | null> {
    return this.records.get(id) ?? null;
  }

  async countByTask(taskId: string): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.taskId === taskId && record.status !== "cancelled") {
        count += 1;
      }
    }
    return count;
  }

  async listByTaskIds(taskIds: string[]): Promise<ReminderRecord[]> {
    return [...this.records.values()].filter((record) => taskIds.includes(record.taskId));
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: ReminderUpdatePatch
  ): Promise<RevisionedUpdateResult<ReminderRecord>> {
    const record = this.records.get(id);
    if (record === undefined) {
      return { kind: "not_found" };
    }
    if (record.revision !== expectedRevision) {
      return { kind: "conflict", serverRevision: record.revision };
    }
    const updated: ReminderRecord = { ...record, ...patch, revision: record.revision + 1, updatedAt: new Date() };
    this.records.set(id, updated);
    return { kind: "ok", record: updated };
  }

  async remove(
    id: string,
    expectedRevision: number
  ): Promise<ReminderDeleteResult | null | { kind: "conflict"; serverRevision: number }> {
    const record = this.records.get(id);
    if (record === undefined) {
      return null;
    }
    if (record.revision !== expectedRevision) {
      return { kind: "conflict", serverRevision: record.revision };
    }
    const updated: ReminderRecord = { ...record, status: "cancelled", revision: record.revision + 1, updatedAt: new Date() };
    this.records.set(id, updated);
    return { kind: "cancelled", record: updated };
  }
}

class FakeTaskRepository implements TaskRepository {
  constructor(private readonly tasks: TaskRecord[]) {}

  async create(): Promise<never> {
    throw new Error("not implemented");
  }
  async createWithClientMutation(): Promise<never> {
    throw new Error("not implemented");
  }
  async update(): Promise<never> {
    throw new Error("not implemented");
  }
  async complete(): Promise<never> {
    throw new Error("not implemented");
  }
  async remove(): Promise<never> {
    throw new Error("not implemented");
  }
  async countByOwner(): Promise<never> {
    throw new Error("not implemented");
  }
  async listByAnalysis(): Promise<never> {
    throw new Error("not implemented");
  }
  async listByOwner(): Promise<never> {
    throw new Error("not implemented");
  }
  async listActivePageByOwner(): Promise<never> {
    throw new Error("not implemented");
  }
  async get(id: string): Promise<TaskRecord | null> {
    return this.tasks.find((task) => task.id === id) ?? null;
  }
}

function task(id: string, sessionId: string): TaskRecord {
  const now = new Date();
  return {
    id,
    analysisId: null,
    sessionId,
    userId: null,
    title: "t",
    description: null,
    simpleTitle: "t",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium",
    status: "pending",
    dueAt: null,
    timezone: null,
    sourceData: null,
    aiOriginal: null,
    clientMutationId: null,
    revision: 1,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

const OWNER = { sessionId: "s1", userId: null };
const FUTURE = () => new Date(Date.now() + 86_400_000);

test("ReminderService.create: создаёт напоминание и повторный idempotencyKey возвращает то же", async () => {
  const tasks = new FakeTaskRepository([task("task-1", "s1")]);
  const service = new ReminderService(new InMemoryReminderRepository(), tasks);
  const first = await service.create(OWNER, {
    taskId: "task-1",
    scheduledAt: FUTURE(),
    timezone: "Asia/Dushanbe",
    channel: "in_app",
    idempotencyKey: "idem_0001",
  });
  const second = await service.create(OWNER, {
    taskId: "task-1",
    scheduledAt: FUTURE(),
    timezone: "Asia/Dushanbe",
    channel: "in_app",
    idempotencyKey: "idem_0001",
  });
  assert.equal(first.id, second.id);
  assert.equal(first.revision, 1);
});

test("ReminderService.create: время в прошлом → REMINDER_TIME_IN_PAST", async () => {
  const tasks = new FakeTaskRepository([task("task-1", "s1")]);
  const service = new ReminderService(new InMemoryReminderRepository(), tasks);
  await assert.rejects(
    () =>
      service.create(OWNER, {
        taskId: "task-1",
        scheduledAt: new Date(Date.now() - 1000),
        timezone: "Asia/Dushanbe",
        channel: "in_app",
      }),
    (error: unknown) => error instanceof AppError && error.code === "REMINDER_TIME_IN_PAST"
  );
});

test("ReminderService.create: чужая задача → NOT_FOUND", async () => {
  const tasks = new FakeTaskRepository([task("task-1", "s1")]);
  const service = new ReminderService(new InMemoryReminderRepository(), tasks);
  await assert.rejects(
    () =>
      service.create(
        { sessionId: "other", userId: null },
        { taskId: "task-1", scheduledAt: FUTURE(), timezone: "Asia/Dushanbe", channel: "in_app" }
      ),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});

test("ReminderService.patch/remove: optimistic concurrency и отмена", async () => {
  const tasks = new FakeTaskRepository([task("task-1", "s1")]);
  const service = new ReminderService(new InMemoryReminderRepository(), tasks);
  const reminder = await service.create(OWNER, {
    taskId: "task-1",
    scheduledAt: FUTURE(),
    timezone: "Asia/Dushanbe",
    channel: "in_app",
  });
  const updated = await service.patch(OWNER, reminder.id, 1, { timezone: "Asia/Almaty" });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    () => service.patch(OWNER, reminder.id, 1, { timezone: "UTC" }),
    (error: unknown) =>
      error instanceof AppError && error.code === "VERSION_CONFLICT" && error.params.serverRevision === 2
  );
  await assert.rejects(
    () =>
      service.patch(OWNER, reminder.id, 2, {
        scheduledAt: new Date(Date.now() - 5000),
      }),
    (error: unknown) => error instanceof AppError && error.code === "REMINDER_TIME_IN_PAST"
  );
  await service.remove(OWNER, reminder.id, 2);
  const cancelled = await service.get(OWNER, reminder.id);
  assert.ok(cancelled !== null);
  assert.equal(cancelled.status, "cancelled");
});
