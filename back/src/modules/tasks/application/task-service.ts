import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import { revisionConflict } from "../../versioning/domain/concurrency";
import type {
  TaskCreateInput,
  TaskRecord,
  TaskRepository,
  TaskUpdatePatch,
} from "./task-repository";

export interface TaskOwner {
  sessionId: string | null;
  userId: string | null;
}

export interface TaskCreateCommand
  extends Omit<TaskCreateInput, "id" | "sessionId" | "userId" | "clientMutationId"> {
  clientMutationId?: string | null;
}

export interface TaskServiceOptions {
  maxTasksPerOwner: number;
}

export const DEFAULT_TASK_OPTIONS: TaskServiceOptions = {
  maxTasksPerOwner: 500,
};

/**
 * Application-сервис задач (создание из анализа, PATCH с optimistic
 * concurrency, complete/remove). Все мутации проверяют владельца
 * (session XOR user) и ревизию.
 */
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly options: TaskServiceOptions = DEFAULT_TASK_OPTIONS
  ) {}

  async create(owner: TaskOwner, input: TaskCreateCommand): Promise<TaskRecord> {
    this.assertOwner(owner);
    const count = await this.repository.countByOwner(owner.sessionId, owner.userId);
    if (count >= this.options.maxTasksPerOwner) {
      throw new AppError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "Превышен лимит задач",
        params: { resource: "tasks", limit: this.options.maxTasksPerOwner },
      });
    }
    const { clientMutationId = null, ...rest } = input;
    const createInput: TaskCreateInput = {
      ...rest,
      id: randomHex(16),
      sessionId: owner.sessionId,
      userId: owner.userId,
      clientMutationId,
    };
    const result = await this.repository.createWithClientMutation(createInput);
    return result.record;
  }

  async get(owner: TaskOwner, id: string): Promise<TaskRecord | null> {
    this.assertOwner(owner);
    const record = await this.repository.get(id);
    if (record === null || !this.isOwner(record, owner) || record.deletedAt !== null) {
      return null;
    }
    return record;
  }

  async patch(
    owner: TaskOwner,
    id: string,
    expectedRevision: number,
    patch: TaskUpdatePatch
  ): Promise<TaskRecord> {
    this.assertOwner(owner);
    const current = await this.get(owner, id);
    if (current === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError({ code: "VALIDATION_ERROR", message: "PATCH не содержит полей" });
    }
    const result = await this.repository.update(id, expectedRevision, patch);
    switch (result.kind) {
      case "ok":
        return result.record;
      case "conflict":
        throw revisionConflict(result.serverRevision);
      case "not_found":
        throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
  }

  async complete(owner: TaskOwner, id: string, expectedRevision: number): Promise<TaskRecord> {
    this.assertOwner(owner);
    const current = await this.get(owner, id);
    if (current === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
    const result = await this.repository.complete(id, expectedRevision);
    switch (result.kind) {
      case "ok":
        return result.record;
      case "conflict":
        throw revisionConflict(result.serverRevision);
      case "not_found":
        throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
  }

  async remove(owner: TaskOwner, id: string, expectedRevision: number): Promise<void> {
    this.assertOwner(owner);
    const current = await this.get(owner, id);
    if (current === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
    const result = await this.repository.remove(id, expectedRevision);
    switch (result.kind) {
      case "ok":
        return;
      case "conflict":
        throw revisionConflict(result.serverRevision);
      case "not_found":
        throw new AppError({ code: "NOT_FOUND", message: "Задача не найдена" });
    }
  }

  private isOwner(record: TaskRecord, owner: TaskOwner): boolean {
    return (
      (owner.sessionId !== null && record.sessionId === owner.sessionId) ||
      (owner.userId !== null && record.userId === owner.userId)
    );
  }

  private assertOwner(owner: TaskOwner): void {
    const hasSession = owner.sessionId !== null;
    const hasUser = owner.userId !== null;
    if (hasSession === hasUser) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Владелец: session XOR user" });
    }
  }
}
