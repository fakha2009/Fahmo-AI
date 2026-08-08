import { z } from "zod";
import { AppError } from "../../shared/errors";
import type { ReminderRecord } from "../../modules/reminders/application/reminder-repository";
import { ReminderCreateSchema, ReminderUpdateSchema } from "../../validation/response/reminder";
import { readJsonBody } from "../body";
import type { RouteHandler } from "../router";
import { sendJson, sendNoContent } from "../responses";
import { requireSession } from "../session";

const ReminderCreateBodySchema = ReminderCreateSchema.safeExtend({
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._-]+$/).optional(),
});
const ReminderUpdateBodySchema = ReminderUpdateSchema.safeExtend({
  expectedRevision: z.number().int().min(1),
});
const ReminderDeleteBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export const createReminderRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = ReminderCreateBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  const record = await ctx.reminderService.create(owner(session.session.id), {
    taskId: params.taskId ?? "",
    scheduledAt: new Date(parsed.data.scheduledAt),
    timezone: parsed.data.timezone,
    channel: parsed.data.channel,
    idempotencyKey: parsed.data.idempotencyKey ?? null,
  });
  sendJson({ res, rc, status: 201, body: reminderToResponse(record) });
};

export const patchReminderRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = ReminderUpdateBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  const { expectedRevision, scheduledAt, status: _status, ...patch } = parsed.data;
  const record = await ctx.reminderService.patch(
    owner(session.session.id),
    params.reminderId ?? "",
    expectedRevision,
    { ...patch, ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }) }
  );
  sendJson({ res, rc, body: reminderToResponse(record) });
};

export const deleteReminderRoute: RouteHandler = async ({ req, res, ctx, rc, params }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = ReminderDeleteBodySchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  await ctx.reminderService.remove(
    owner(session.session.id),
    params.reminderId ?? "",
    parsed.data.expectedRevision
  );
  sendNoContent({ res, rc });
};

function owner(sessionId: string) {
  return { sessionId, userId: null };
}

export function reminderToResponse(reminder: ReminderRecord) {
  return {
    id: reminder.id,
    taskId: reminder.taskId,
    scheduledAt: reminder.scheduledAt.toISOString(),
    timezone: reminder.timezone,
    channel: reminder.channel,
    status: reminder.status,
    revision: reminder.revision,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

function validationError(error: z.ZodError): AppError {
  return new AppError({ code: "VALIDATION_ERROR", message: "Некорректные данные напоминания", details: error.issues });
}
