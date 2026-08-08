import { z } from "zod";
import { AppError } from "../../shared/errors";
import { TaskCreateSchema, TaskUpdateSchema } from "../../validation/response/task";
import type { TaskRecord } from "../../modules/tasks/application/task-repository";
import { readJsonBody } from "../body";
import type { RouteHandler } from "../router";
import { sendJson, sendNoContent } from "../responses";
import { requireSession } from "../session";
import { reminderToResponse } from "./reminders";

const RevisionBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export const listTasksRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const requestedLimit = Number(new URL(req.url ?? "/", "http://localhost").searchParams.get("limit") ?? 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
  const tasks = await ctx.taskRepository.listActivePageByOwner(session.session.id, null, limit);
  const reminders = await ctx.reminderRepository.listByTaskIds(tasks.map((task) => task.id));
  const byTask = new Map<string, ReturnType<typeof reminderToResponse>[]>();
  for (const reminder of reminders) {
    if (reminder.status === "cancelled") continue;
    const items = byTask.get(reminder.taskId) ?? [];
    items.push(reminderToResponse(reminder));
    byTask.set(reminder.taskId, items);
  }
  sendJson({
    res,
    rc,
    body: { items: tasks.map((task) => ({ ...taskToResponse(task), reminders: byTask.get(task.id) ?? [] })) },
  });
};

export const listAnalysisTasksRoute: RouteHandler = async ({ res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const analysis = await ctx.analysisRepository.get(params.analysisId ?? "");
  if (analysis === null || analysis.sessionId !== session.session.id) {
    throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
  }
  const tasks = await ctx.taskRepository.listByAnalysis(analysis.id);
  sendJson({ res, rc, body: { items: tasks.filter((task) => task.deletedAt === null).map(taskToResponse) } });
};

export const createTaskRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = TaskCreateSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  if (parsed.data.analysisId !== undefined) {
    const analysis = await ctx.analysisRepository.get(parsed.data.analysisId);
    if (analysis === null || analysis.sessionId !== session.session.id) {
      throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
    }
  }
  const record = await ctx.taskService.create(owner(session.session.id), {
    analysisId: parsed.data.analysisId ?? null,
    title: parsed.data.title.trim(),
    description: parsed.data.description ?? null,
    simpleTitle: parsed.data.simpleTitle ?? parsed.data.title.trim(),
    simpleDescription: parsed.data.simpleDescription ?? null,
    assigneeText: parsed.data.assigneeText ?? null,
    priority: parsed.data.priority,
    status: parsed.data.status,
    dueAt: parsed.data.dueAt === null || parsed.data.dueAt === undefined ? null : new Date(parsed.data.dueAt),
    timezone: parsed.data.timezone ?? null,
    sourceData: null,
    aiOriginal: null,
    clientMutationId: parsed.data.clientMutationId ?? null,
  });
  sendJson({ res, rc, status: 201, body: taskToResponse(record) });
};

export const patchTaskRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = TaskUpdateSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  const expectedRevision = revisionFrom(req.headers["if-match"], parsed.data.expectedRevision);
  const { expectedRevision: _ignored, dueAt, ...patch } = parsed.data;
  const record = await ctx.taskService.patch(owner(session.session.id), params.taskId ?? "", expectedRevision, {
    ...patch,
    ...(dueAt !== undefined && { dueAt: dueAt === null ? null : new Date(dueAt) }),
  });
  sendJson({ res, rc, body: taskToResponse(record) });
};

export const completeTaskRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = RevisionBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  const record = await ctx.taskService.complete(
    owner(session.session.id),
    params.taskId ?? "",
    revisionFrom(req.headers["if-match"], parsed.data.expectedRevision)
  );
  sendJson({ res, rc, body: taskToResponse(record) });
};

export const deleteTaskRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = RevisionBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  await ctx.taskService.remove(
    owner(session.session.id),
    params.taskId ?? "",
    revisionFrom(req.headers["if-match"], parsed.data.expectedRevision)
  );
  sendNoContent({ res, rc });
};

function owner(sessionId: string) {
  return { sessionId, userId: null };
}

function revisionFrom(header: string | string[] | undefined, bodyRevision: number | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  const match = typeof value === "string" ? /^revision-(\d+)$/.exec(value) : null;
  const revision = match?.[1] === undefined ? bodyRevision : Number(match[1]);
  if (!Number.isInteger(revision) || (revision ?? 0) < 1) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Требуется expectedRevision" });
  }
  return revision as number;
}

function validationError(error: z.ZodError): AppError {
  return new AppError({ code: "VALIDATION_ERROR", message: "Некорректные данные задачи", details: error.issues });
}

export function taskToResponse(task: TaskRecord) {
  return {
    id: task.id,
    analysisId: task.analysisId,
    title: task.title,
    description: task.description,
    simpleTitle: task.simpleTitle,
    simpleDescription: task.simpleDescription,
    assigneeText: task.assigneeText,
    priority: task.priority,
    status: task.status,
    completed: task.status === "completed",
    dueAt: task.dueAt?.toISOString() ?? null,
    dueDate: task.dueAt?.toISOString().slice(0, 10) ?? null,
    dueTime: task.dueAt?.toISOString().slice(11, 16) ?? null,
    timezone: task.timezone,
    revision: task.revision,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
