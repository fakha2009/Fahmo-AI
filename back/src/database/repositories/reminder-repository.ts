import { Prisma, type Reminder as PrismaReminder } from "@prisma/client";
import { prisma } from "../client";
import { reminderChannel, reminderStatus } from "../mappers/enums";
import type {
  ReminderCreateInput,
  ReminderDeleteResult,
  ReminderRecord,
  ReminderRepository,
  ReminderUpdatePatch,
} from "../../modules/reminders/application/reminder-repository";
import type { RevisionedUpdateResult } from "../../modules/versioning/domain/concurrency";

export class PrismaReminderRepository implements ReminderRepository {
  async create(input: ReminderCreateInput): Promise<ReminderRecord> {
    const row = await prisma.reminder.create({
      data: {
        id: input.id,
        task: { connect: { id: input.taskId } },
        scheduled_at: input.scheduledAt,
        timezone: input.timezone,
        channel: reminderChannel.toPrisma(input.channel),
        idempotency_key: input.idempotencyKey,
      },
    });
    return reminderToRecord(row);
  }

  async createWithIdempotencyKey(input: ReminderCreateInput): Promise<ReminderRecord> {
    if (input.idempotencyKey === null) {
      return this.create(input);
    }
    try {
      return await this.create(input);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
      const existing = await prisma.reminder.findUnique({
        where: { idempotency_key: input.idempotencyKey },
      });
      if (existing === null) {
        throw error;
      }
      return reminderToRecord(existing);
    }
  }

  async get(id: string): Promise<ReminderRecord | null> {
    const row = await prisma.reminder.findUnique({ where: { id } });
    return row === null ? null : reminderToRecord(row);
  }

  async countByTask(taskId: string): Promise<number> {
    return prisma.reminder.count({
      where: { task_id: taskId, status: { not: "CANCELLED" } },
    });
  }

  async listByTaskIds(taskIds: string[]): Promise<ReminderRecord[]> {
    if (taskIds.length === 0) {
      return [];
    }
    const rows = await prisma.reminder.findMany({
      where: { task_id: { in: taskIds } },
      orderBy: { scheduled_at: "asc" },
    });
    return rows.map(reminderToRecord);
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: ReminderUpdatePatch
  ): Promise<RevisionedUpdateResult<ReminderRecord>> {
    return optimisticUpdate(id, expectedRevision, {
      ...(patch.scheduledAt !== undefined && { scheduled_at: patch.scheduledAt }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.channel !== undefined && {
        channel: reminderChannel.toPrisma(patch.channel),
      }),
    });
  }

  async remove(
    id: string,
    expectedRevision: number
  ): Promise<ReminderDeleteResult | null | { kind: "conflict"; serverRevision: number }> {
    const updated = await prisma.reminder.updateMany({
      where: { id, revision: expectedRevision },
      data: { status: reminderStatus.toPrisma("cancelled"), revision: { increment: 1 } },
    });
    if (updated.count === 0) {
      const current = await prisma.reminder.findUnique({ where: { id } });
      if (current === null) {
        return null;
      }
      return { kind: "conflict", serverRevision: current.revision };
    }
    const row = await prisma.reminder.findUnique({ where: { id } });
    if (row === null) {
      return null;
    }
    return { kind: "cancelled", record: reminderToRecord(row) };
  }
}

async function optimisticUpdate(
  id: string,
  expectedRevision: number,
  data: Prisma.ReminderUpdateManyMutationInput
): Promise<RevisionedUpdateResult<ReminderRecord>> {
  const updated = await prisma.reminder.updateMany({
    where: { id, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count === 0) {
    const current = await prisma.reminder.findUnique({ where: { id } });
    if (current === null) {
      return { kind: "not_found" };
    }
    return { kind: "conflict", serverRevision: current.revision };
  }
  const row = await prisma.reminder.findUnique({ where: { id } });
  if (row === null) {
    return { kind: "not_found" };
  }
  return { kind: "ok", record: reminderToRecord(row) };
}

export function reminderToRecord(row: PrismaReminder): ReminderRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    channel: reminderChannel.fromPrisma(row.channel),
    status: reminderStatus.fromPrisma(row.status),
    idempotencyKey: row.idempotency_key,
    revision: row.revision,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
