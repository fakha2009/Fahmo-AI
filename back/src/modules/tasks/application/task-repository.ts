import type { TaskPriority, TaskStatus } from "../../../validation/common";
import type { RevisionedUpdateResult } from "../../versioning/domain/concurrency";

export interface TaskCreateInput {
  id: string;
  analysisId: string | null;
  sessionId: string | null;
  userId: string | null;
  title: string;
  description: string | null;
  simpleTitle: string;
  simpleDescription: string | null;
  assigneeText: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  timezone: string | null;
  sourceData: unknown | null;
  aiOriginal: unknown | null;
  clientMutationId: string | null;
}

export interface TaskRecord {
  id: string;
  analysisId: string | null;
  sessionId: string | null;
  userId: string | null;
  title: string;
  description: string | null;
  simpleTitle: string;
  simpleDescription: string | null;
  assigneeText: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  timezone: string | null;
  sourceData: unknown | null;
  aiOriginal: unknown | null;
  clientMutationId: string | null;
  revision: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TaskUpdatePatch {
  title?: string;
  description?: string | null;
  simpleTitle?: string;
  simpleDescription?: string | null;
  assigneeText?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueAt?: Date | null;
  timezone?: string | null;
}

export type TaskCreateWithMutationResult =
  | { kind: "created"; record: TaskRecord }
  | { kind: "reused"; record: TaskRecord };

export interface TaskRepository {
  create(input: TaskCreateInput): Promise<TaskRecord>;
  /**
   * Идемпотентное создание по clientMutationId: повторный запрос с тем же
   * ключом (и тем же владельцем) возвращает существующую задачу.
   */
  createWithClientMutation(input: TaskCreateInput): Promise<TaskCreateWithMutationResult>;
  get(id: string): Promise<TaskRecord | null>;
  /** Все задачи анализа (включая удалённые — для экспорта пользовательских данных). */
  listByAnalysis(analysisId: string): Promise<TaskRecord[]>;
  /** Все задачи владельца, включая удалённые (для экспорта). */
  listByOwner(sessionId: string | null, userId: string | null): Promise<TaskRecord[]>;
  /** Активные (не удалённые) задачи владельца. */
  countByOwner(sessionId: string | null, userId: string | null): Promise<number>;
  update(
    id: string,
    expectedRevision: number,
    patch: TaskUpdatePatch
  ): Promise<RevisionedUpdateResult<TaskRecord>>;
  complete(id: string, expectedRevision: number): Promise<RevisionedUpdateResult<TaskRecord>>;
  /** Мягкое удаление (deleted_at) с проверкой версии. */
  remove(id: string, expectedRevision: number): Promise<RevisionedUpdateResult<TaskRecord>>;
}
