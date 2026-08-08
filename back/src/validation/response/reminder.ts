import { z } from "zod";
import {
  IdSchema,
  IsoDateTimeSchema,
  ReminderChannelSchema,
  ReminderStatusSchema,
  TimezoneSchema,
} from "../common";
import { RevisionNumberSchema } from "../request/revision";

export const ReminderSchema = z
  .object({
    id: IdSchema,
    taskId: IdSchema,
    scheduledAt: IsoDateTimeSchema,
    timezone: TimezoneSchema,
    channel: ReminderChannelSchema,
    status: ReminderStatusSchema,
    revision: RevisionNumberSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ReminderCreateSchema = z
  .object({
    scheduledAt: IsoDateTimeSchema,
    timezone: TimezoneSchema,
    channel: ReminderChannelSchema.default("in_app"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Date(value.scheduledAt).getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: `время напоминания должно быть в будущем: ${value.scheduledAt}`,
      });
    }
  });

export const ReminderUpdateSchema = z
  .object({
    scheduledAt: IsoDateTimeSchema.optional(),
    timezone: TimezoneSchema.optional(),
    channel: ReminderChannelSchema.optional(),
    status: ReminderStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "PATCH должен содержать хотя бы одно поле",
      });
    }
  });

export type Reminder = z.infer<typeof ReminderSchema>;
