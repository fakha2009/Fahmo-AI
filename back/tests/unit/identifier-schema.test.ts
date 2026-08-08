import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AnalysisStatusResponseSchema } from "../../src/validation/response/analysis-status";
import { ExportCreateRequestSchema, ExportJobSchema } from "../../src/validation/response/export";
import { TaskCreateSchema, TaskSchema } from "../../src/validation/response/task";

const ANALYSIS_UUID = "038282bb-f512-4c67-b492-b88c4f401815";
const RESOURCE_ID = "1234567890abcdef1234567890abcdef";

test("analysis UUID is accepted consistently by export, task, and status contracts", () => {
  assert.equal(ExportCreateRequestSchema.safeParse({ kind: "pdf", analysisId: ANALYSIS_UUID }).success, true);
  assert.equal(TaskCreateSchema.safeParse({ title: "Task", analysisId: ANALYSIS_UUID }).success, true);
  assert.equal(AnalysisStatusResponseSchema.safeParse({
    analysisId: ANALYSIS_UUID,
    status: "queued",
    stage: "queued",
    progress: 0,
    messageKey: "errors.analysisQueued",
    updatedAt: "2026-08-08T10:00:00.000Z",
  }).success, true);
});

test("response contracts accept UUID analysisId without weakening resource ids", () => {
  assert.equal(ExportJobSchema.safeParse({
    id: RESOURCE_ID,
    kind: "pdf",
    status: "done",
    analysisId: ANALYSIS_UUID,
    storageKey: "exports/report.pdf",
    errorCode: null,
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:01:00.000Z",
    completedAt: "2026-08-08T10:01:00.000Z",
    expiresAt: "2026-08-09T10:00:00.000Z",
  }).success, true);
  assert.equal(TaskSchema.safeParse({
    id: RESOURCE_ID,
    analysisId: ANALYSIS_UUID,
    title: "Task",
    description: null,
    simpleTitle: "Task",
    simpleDescription: null,
    assigneeText: null,
    priority: "medium",
    status: "pending",
    dueAt: null,
    timezone: null,
    clientMutationId: null,
    revision: 1,
    completedAt: null,
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:00.000Z",
  }).success, true);
});
