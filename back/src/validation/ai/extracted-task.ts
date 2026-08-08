import { z } from "zod";
import { ConfidenceLevelSchema, TaskPrioritySchema, TaskStatusSchema } from "../common";
import { ExtractedDateSchema } from "./extracted-date";
import { SourceReferenceSchema } from "./source-reference";

export const ExtractedTaskSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(500),
    description: z.string().max(2000).nullable(),
    simpleTitle: z.string().min(1).max(500),
    simpleDescription: z.string().max(2000).nullable(),
    assigneeText: z.string().max(500).nullable(),
    priority: TaskPrioritySchema,
    status: TaskStatusSchema,
    deadline: ExtractedDateSchema.nullable(),
    confidence: ConfidenceLevelSchema,
    sourceRefs: z.array(SourceReferenceSchema),
    requiresClarification: z.boolean(),
  })
  .strict();

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
