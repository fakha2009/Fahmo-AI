import { z } from "zod";
import { AnalysisIdSchema, ExportJobStatusSchema, ExportKindSchema, IdSchema } from "../common";

export const ExportJobSchema = z
  .object({
    id: IdSchema,
    kind: ExportKindSchema,
    status: ExportJobStatusSchema,
    analysisId: AnalysisIdSchema.nullable(),
    storageKey: z.string().max(256).nullable(),
    errorCode: z.string().max(64).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const ExportCreateRequestSchema = z
  .object({
    kind: ExportKindSchema,
    analysisId: AnalysisIdSchema.optional().nullable(),
    taskIds: z.array(IdSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "pdf" && (value.analysisId === undefined || value.analysisId === null)) {
      ctx.addIssue({ code: "custom", path: ["analysisId"], message: "analysisId обязателен для PDF" });
    }
    if (value.kind === "ics" && (value.taskIds === undefined || value.taskIds.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["taskIds"], message: "taskIds обязателен для ICS" });
    }
  });

export const ExportJobListSchema = z
  .object({
    items: z.array(ExportJobSchema),
  })
  .strict();

export type ExportJob = z.infer<typeof ExportJobSchema>;
export type ExportCreateRequest = z.infer<typeof ExportCreateRequestSchema>;
