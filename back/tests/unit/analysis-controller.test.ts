import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { AnalysisController } from "../../src/modules/analysis/application/analysis-controller";
import type { AnalysisPipeline } from "../../src/modules/analysis/application/analysis-pipeline";
import type { AnalysisRecord, AnalysisRepository } from "../../src/modules/analysis/application/analysis-repository";

const record = {
  id: "analysis-1",
  status: "processing",
  stage: "analyzing",
  progress: 88,
  errorCode: null,
} as AnalysisRecord;

test("AnalysisController.cancel is idempotent when completion wins the race", async () => {
  const repository = { get: async () => record } as unknown as AnalysisRepository;
  const pipeline = { cancel: async () => false } as unknown as AnalysisPipeline;
  const controller = new AnalysisController({ repository, pipeline });

  assert.equal(await controller.cancel(record.id, "user"), false);
});

test("AnalysisController.cancel still rejects an unknown analysis", async () => {
  const repository = { get: async () => null } as unknown as AnalysisRepository;
  let pipelineCalled = false;
  const pipeline = {
    cancel: async () => {
      pipelineCalled = true;
      return false;
    },
  } as unknown as AnalysisPipeline;
  const controller = new AnalysisController({ repository, pipeline });

  await assert.rejects(
    controller.cancel("missing", "user"),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND",
  );
  assert.equal(pipelineCalled, false);
});
