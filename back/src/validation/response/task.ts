import { z } from "zod";
import {
  IdSchema,
  AnalysisIdSchema,
  IsoDateTimeSchema,
  TaskPrioritySchema,
  TaskStatusSchema,
  TimezoneSchema,
} from "../common";
import { ClientMutationIdSchema, IdempotencyKeySchema } from "../request/idempotency";
import { RevisionNumberSchema } from "../request/revision";

export const TaskSchema = z
  .object({
    id: IdSchema,
    analysisId: AnalysisIdSchema.nullable(),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(5000).nullable(),
    simpleTitle: z.string().min(1).max(200),
    simpleDescription: z.string().min(1).max(2000).nullable(),
    assigneeText: z.string().min(1).max(200).nullable(),
    priority: TaskPrioritySchema,
    status: TaskStatusSchema,
    dueAt: IsoDateTimeSchema.nullable(),
    timezone: TimezoneSchema.nullable(),
    clientMutationId: ClientMutationIdSchema.nullable(),
    revision: RevisionNumberSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const TaskCreateSchema = z
  .object({
    analysisId: AnalysisIdSchema.optional(),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(5000).nullable().optional(),
    simpleTitle: z.string().min(1).max(200).optional(),
    simpleDescription: z.string().min(1).max(2000).nullable().optional(),
    assigneeText: z.string().min(1).max(200).nullable().optional(),
    priority: TaskPrioritySchema.default("medium"),
    status: TaskStatusSchema.default("pending"),
    dueAt: IsoDateTimeSchema.nullable().optional(),
    timezone: TimezoneSchema.nullable().optional(),
    clientMutationId: ClientMutationIdSchema.optional(),
    idempotencyKey: IdempotencyKeySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.title === undefined || value.title.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "title обязателен" });
    }
  });

export const TaskUpdateSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().min(1).max(5000).nullable().optional(),
    simpleTitle: z.string().min(1).max(200).optional(),
    simpleDescription: z.string().min(1).max(2000).nullable().optional(),
    assigneeText: z.string().min(1).max(200).nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    status: TaskStatusSchema.optional(),
    dueAt: IsoDateTimeSchema.nullable().optional(),
    timezone: TimezoneSchema.nullable().optional(),
    expectedRevision: RevisionNumberSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { expectedRevision: _ignored, ...rest } = value;
    if (Object.keys(rest).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "PATCH должен содержать хотя бы одно поле",
      });
    }
  });

export type Task = z.infer<typeof TaskSchema>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
