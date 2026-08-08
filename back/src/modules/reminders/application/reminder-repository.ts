import type {
  ReminderChannel,
  ReminderStatus,
} from "../../../validation/common";
import type { RevisionedUpdateResult } from "../../versioning/domain/concurrency";

export interface ReminderCreateInput {
  id: string;
  taskId: string;
  scheduledAt: Date;
  timezone: string;
  channel: ReminderChannel;
  idempotencyKey: string | null;
}

export interface ReminderRecord {
  id: string;
  taskId: string;
  scheduledAt: Date;
  timezone: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  idempotencyKey: string | null;
  revision: number;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderUpdatePatch {
  scheduledAt?: Date;
  timezone?: string;
  channel?: ReminderChannel;
}

export type ReminderDeleteResult = { kind: "cancelled"; record: ReminderRecord };

export interface ReminderRepository {
  create(input: ReminderCreateInput): Promise<ReminderRecord>;
  /**
   * Идемпотентное создание по idempotency_key: повторный вызов возвращает
   * существующее напоминание (Reminder.idempotency_key — @unique).
   */
  createWithIdempotencyKey(input: ReminderCreateInput): Promise<ReminderRecord>;
  get(id: string): Promise<ReminderRecord | null>;
  /** Активные (не отменённые) напоминания задачи. */
  countByTask(taskId: string): Promise<number>;
  /** Напоминания указанных задач (включая отменённые — для экспорта). */
  listByTaskIds(taskIds: string[]): Promise<ReminderRecord[]>;
  update(
    id: string,
    expectedRevision: number,
    patch: ReminderUpdatePatch
  ): Promise<RevisionedUpdateResult<ReminderRecord>>;
  /**
   * Удаление напоминания = перевод в CANCELLED (soft), т.к. физическое
   * удаление сломало бы sync по updated_at.
   */
  remove(id: string, expectedRevision: number): Promise<ReminderDeleteResult | null | { kind: "conflict"; serverRevision: number }>;
}
