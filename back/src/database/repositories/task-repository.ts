import { Prisma, type Task as PrismaTask } from "@prisma/client";
import { prisma } from "../client";
import { taskPriority, taskStatus } from "../mappers/enums";
import type {
  TaskCreateInput,
  TaskCreateWithMutationResult,
  TaskRecord,
  TaskRepository,
  TaskUpdatePatch,
} from "../../modules/tasks/application/task-repository";
import type { RevisionedUpdateResult } from "../../modules/versioning/domain/concurrency";

export class PrismaTaskRepository implements TaskRepository {
  async create(input: TaskCreateInput): Promise<TaskRecord> {
    const row = await prisma.task.create({ data: toCreateData(input) });
    return taskToRecord(row);
  }

  async createWithClientMutation(
    input: TaskCreateInput
  ): Promise<TaskCreateWithMutationResult> {
    if (input.clientMutationId === null) {
      return { kind: "created", record: await this.create(input) };
    }
    try {
      const row = await prisma.task.create({ data: toCreateData(input) });
      return { kind: "created", record: taskToRecord(row) };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
      const existing = await this.findByClientMutation(input);
      if (existing === null) {
        throw error;
      }
      return { kind: "reused", record: existing };
    }
  }

  async get(id: string): Promise<TaskRecord | null> {
    const row = await prisma.task.findUnique({ where: { id } });
    return row === null ? null : taskToRecord(row);
  }

  async countByOwner(sessionId: string | null, userId: string | null): Promise<number> {
    const where =
      sessionId !== null
        ? { session_id: sessionId, deleted_at: null }
        : userId !== null
          ? { user_id: userId, deleted_at: null }
          : { deleted_at: null };
    return prisma.task.count({ where });
  }

  async listByAnalysis(analysisId: string): Promise<TaskRecord[]> {
    const rows = await prisma.task.findMany({
      where: { analysis_id: analysisId },
      orderBy: { created_at: "asc" },
    });
    return rows.map(taskToRecord);
  }

  async listByOwner(sessionId: string | null, userId: string | null): Promise<TaskRecord[]> {
    const where =
      sessionId !== null
        ? { session_id: sessionId }
        : userId !== null
          ? { user_id: userId }
          : {};
    const rows = await prisma.task.findMany({ where, orderBy: { created_at: "asc" } });
    return rows.map(taskToRecord);
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: TaskUpdatePatch
  ): Promise<RevisionedUpdateResult<TaskRecord>> {
    return optimisticUpdate(id, expectedRevision, {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.simpleTitle !== undefined && { simple_title: patch.simpleTitle }),
      ...(patch.simpleDescription !== undefined && {
        simple_description: patch.simpleDescription,
      }),
      ...(patch.assigneeText !== undefined && { assignee_text: patch.assigneeText }),
      ...(patch.priority !== undefined && {
        priority: taskPriority.toPrisma(patch.priority),
      }),
      ...(patch.status !== undefined && { status: taskStatus.toPrisma(patch.status) }),
      ...(patch.dueAt !== undefined && { due_at: patch.dueAt }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    });
  }

  async complete(
    id: string,
    expectedRevision: number
  ): Promise<RevisionedUpdateResult<TaskRecord>> {
    return optimisticUpdate(id, expectedRevision, {
      status: taskStatus.toPrisma("completed"),
      completed_at: new Date(),
    });
  }

  async remove(
    id: string,
    expectedRevision: number
  ): Promise<RevisionedUpdateResult<TaskRecord>> {
    return optimisticUpdate(id, expectedRevision, { deleted_at: new Date() });
  }

  private async findByClientMutation(
    input: TaskCreateInput
  ): Promise<TaskRecord | null> {
    const row =
      input.sessionId !== null
        ? await prisma.task.findFirst({
            where: {
              client_mutation_id: input.clientMutationId,
              session_id: input.sessionId,
            },
          })
        : input.userId !== null
          ? await prisma.task.findFirst({
              where: {
                client_mutation_id: input.clientMutationId,
                user_id: input.userId,
              },
            })
          : null;
    return row === null ? null : taskToRecord(row);
  }
}

function toCreateData(input: TaskCreateInput): Prisma.TaskCreateInput {
  return {
    id: input.id,
    analysis: input.analysisId === null ? undefined : { connect: { id: input.analysisId } },
    session: input.sessionId === null ? undefined : { connect: { id: input.sessionId } },
    user: input.userId === null ? undefined : { connect: { id: input.userId } },
    title: input.title,
    description: input.description,
    simple_title: input.simpleTitle,
    simple_description: input.simpleDescription,
    assignee_text: input.assigneeText,
    priority: taskPriority.toPrisma(input.priority),
    status: taskStatus.toPrisma(input.status),
    due_at: input.dueAt,
    timezone: input.timezone,
    source_data: input.sourceData as Prisma.InputJsonValue | undefined,
    ai_original: input.aiOriginal as Prisma.InputJsonValue | undefined,
    client_mutation_id: input.clientMutationId,
  };
}

async function optimisticUpdate(
  id: string,
  expectedRevision: number,
  data: Prisma.TaskUpdateManyMutationInput
): Promise<RevisionedUpdateResult<TaskRecord>> {
  const updated = await prisma.task.updateMany({
    where: { id, revision: expectedRevision, deleted_at: null },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count === 0) {
    const current = await prisma.task.findUnique({ where: { id } });
    if (current === null || current.deleted_at !== null) {
      return { kind: "not_found" };
    }
    return { kind: "conflict", serverRevision: current.revision };
  }
  const row = await prisma.task.findUnique({ where: { id } });
  if (row === null) {
    return { kind: "not_found" };
  }
  return { kind: "ok", record: taskToRecord(row) };
}

export function taskToRecord(row: PrismaTask): TaskRecord {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    sessionId: row.session_id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    simpleTitle: row.simple_title,
    simpleDescription: row.simple_description,
    assigneeText: row.assignee_text,
    priority: taskPriority.fromPrisma(row.priority),
    status: taskStatus.fromPrisma(row.status),
    dueAt: row.due_at,
    timezone: row.timezone,
    sourceData: row.source_data,
    aiOriginal: row.ai_original,
    clientMutationId: row.client_mutation_id,
    revision: row.revision,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
