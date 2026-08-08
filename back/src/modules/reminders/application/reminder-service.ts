import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import { revisionConflict } from "../../versioning/domain/concurrency";
import type { TaskRepository } from "../../tasks/application/task-repository";
import type {
  ReminderRecord,
  ReminderRepository,
  ReminderUpdatePatch,
} from "./reminder-repository";

export interface ReminderOwner {
  sessionId: string | null;
  userId: string | null;
}

export interface CreateReminderInput {
  taskId: string;
  scheduledAt: Date;
  timezone: string;
  channel: ReminderRecord["channel"];
  idempotencyKey?: string | null;
}

export interface ReminderServiceOptions {
  maxRemindersPerTask: number;
}

export const DEFAULT_REMINDER_OPTIONS: ReminderServiceOptions = {
  maxRemindersPerTask: 10,
};

/**
 * Application-сервис напоминаний. Владелец напоминания — владелец задачи;
 * создание идемпотентно по idempotencyKey; время в прошлом отклоняется
 * (REMINDER_TIME_IN_PAST); PATCH — optimistic concurrency.
 */
export class ReminderService {
  constructor(
    private readonly repository: ReminderRepository,
    private readonly tasks: TaskRepository,
    private readonly options: ReminderServiceOptions = DEFAULT_REMINDER_OPTIONS,
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(owner: ReminderOwner, input: CreateReminderInput): Promise<ReminderRecord> {
    await this.assertTaskOwner(owner, input.taskId);
    if (input.scheduledAt.getTime() <= this.now().getTime()) {
      throw new AppError({ code: "REMINDER_TIME_IN_PAST" });
    }
    const count = await this.repository.countByTask(input.taskId);
    if (count >= this.options.maxRemindersPerTask) {
      throw new AppError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Превышен лимит напоминаний задачи",
        params: { resource: "reminders", limit: this.options.maxRemindersPerTask },
      });
    }
    return this.repository.createWithIdempotencyKey({
      id: randomHex(16),
      taskId: input.taskId,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
      channel: input.channel,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  async get(owner: ReminderOwner, id: string): Promise<ReminderRecord | null> {
    const record = await this.repository.get(id);
    if (record === null) {
      return null;
    }
    const task = await this.tasks.get(record.taskId);
    if (task === null || !this.isOwner(task, owner)) {
      return null;
    }
    return record;
  }

  async patch(
    owner: ReminderOwner,
    id: string,
    expectedRevision: number,
    patch: ReminderUpdatePatch
  ): Promise<ReminderRecord> {
    const current = await this.get(owner, id);
    if (current === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Напоминание не найдено" });
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError({ code: "VALIDATION_ERROR", message: "PATCH не содержит полей" });
    }
    if (patch.scheduledAt !== undefined && patch.scheduledAt.getTime() <= this.now().getTime()) {
      throw new AppError({ code: "REMINDER_TIME_IN_PAST" });
    }
    const result = await this.repository.update(id, expectedRevision, patch);
    switch (result.kind) {
      case "ok":
        return result.record;
      case "conflict":
        throw revisionConflict(result.serverRevision);
      case "not_found":
        throw new AppError({ code: "NOT_FOUND", message: "Напоминание не найдено" });
    }
  }

  async remove(owner: ReminderOwner, id: string, expectedRevision: number): Promise<void> {
    const current = await this.get(owner, id);
    if (current === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Напоминание не найдено" });
    }
    const result = await this.repository.remove(id, expectedRevision);
    if (result === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Напоминание не найдено" });
    }
    if (result.kind === "conflict") {
      throw revisionConflict(result.serverRevision);
    }
  }

  private async assertTaskOwner(owner: ReminderOwner, taskId: string): Promise<void> {
    const task = await this.tasks.get(taskId);
    if (task === null || !this.isOwner(task, owner)) {
      throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
  }

  private isOwner(
    record: { sessionId: string | null; userId: string | null },
    owner: ReminderOwner
  ): boolean {
    return (
      (owner.sessionId !== null && record.sessionId === owner.sessionId) ||
      (owner.userId !== null && record.userId === owner.userId)
    );
  }
}
