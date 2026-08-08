import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import type { AnalysisResult } from "../../src/validation/ai/analysis-result";
import { AnalysisPipeline } from "../../src/modules/analysis/application/analysis-pipeline";
import {
  InMemoryAnalysisEventPublisher,
} from "../../src/modules/analysis/application/analysis-event-publisher";
import type { AnalysisRecord, AnalysisRepository, AnalysisUpdateResult } from "../../src/modules/analysis/application/analysis-repository";
import type { JobRepository } from "../../src/modules/analysis/application/job-repository";
import type {
  InputEnvelope,
  PreviewPolicy,
  ProcessedFile,
} from "../../src/modules/ingestion/domain/types";
import type {
  AnalyzeDocumentInput,
} from "../../src/ai/gateway/provider";
import { STAGE_ORDER } from "../../src/modules/analysis/domain/stages";

class InMemoryAnalysisRepository implements AnalysisRepository {
  private records = new Map<string, AnalysisRecord>();

  async create(input: Parameters<AnalysisRepository["create"]>[0]): Promise<AnalysisRecord> {
    const now = new Date();
    const record: AnalysisRecord = {
      id: input.id,
      sessionId: input.sessionId,
      userId: input.userId,
      status: "queued",
      stage: "queued",
      progress: 0,
      sourceType: input.sourceType,
      documentType: input.documentType,
      outputLanguage: input.outputLanguage,
      retentionMode: input.retentionMode,
      sourcePreviewMode: input.sourcePreviewMode,
      result: null,
      detectedLanguages: [],
      provider: null,
      model: null,
      errorCode: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.records.set(input.id, record);
    return record;
  }

  async get(id: string): Promise<AnalysisRecord | null> {
    return this.records.get(id) ?? null;
  }

  async listByOwner(sessionId: string | null, userId: string | null): Promise<AnalysisRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.sessionId === sessionId && record.userId === userId
    );
  }

  async updateFields(
    id: string,
    expectedRevision: number,
    patch: Parameters<AnalysisRepository["updateFields"]>[2]
  ): Promise<AnalysisUpdateResult> {
    const record = this.records.get(id);
    if (record === undefined) return { kind: "not_found" };
    if (record.revision !== expectedRevision) {
      return { kind: "conflict", serverRevision: record.revision };
    }
    if (patch.outputLanguage !== undefined) record.outputLanguage = patch.outputLanguage;
    record.revision += 1;
    record.updatedAt = new Date();
    return { kind: "ok", record };
  }

  async updateStage(id: string, stage: AnalysisRecord["stage"], progress: number): Promise<AnalysisRecord | null> {
    const record = this.records.get(id);
    if (
      record === undefined ||
      record.status === "cancelled" ||
      record.status === "failed"
    ) {
      return null;
    }
    record.stage = stage;
    record.progress = progress;
    record.updatedAt = new Date();
    return record;
  }

  async updateStatus(
    id: string,
    status: AnalysisRecord["status"],
    patch?: { errorCode?: string | null; completedAt?: Date | null }
  ): Promise<AnalysisRecord | null> {
    const record = this.records.get(id);
    if (record === undefined) {
      return null;
    }
    record.status = status;
    if (patch?.errorCode !== undefined) record.errorCode = patch.errorCode;
    if (patch?.completedAt !== undefined) record.completedAt = patch.completedAt;
    record.updatedAt = new Date();
    return record;
  }

  async saveResult(id: string, input: Parameters<AnalysisRepository["saveResult"]>[1]): Promise<void> {
    const record = this.records.get(id);
    if (record === undefined) return;
    record.result = input.result;
    record.detectedLanguages = input.detectedLanguages;
    record.provider = input.provider;
    record.model = input.model;
  }
}

class InMemoryJobRepository implements JobRepository {
  readonly jobs: { id: string; queue: string; payload: unknown; completed: boolean; failed: boolean }[] = [];
  private counter = 0;

  async enqueue(queue: string, payload: unknown) {
    this.counter += 1;
    const job = { id: `job-${this.counter}`, queue, payload, completed: false, failed: false };
    this.jobs.push(job);
    return { id: job.id, queue, payload };
  }

  async complete(id: string) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (job !== undefined) job.completed = true;
  }

  async fail(id: string, errorCode: string) {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (job !== undefined) {
      job.failed = true;
      job.payload = { ...(job.payload as Record<string, unknown>), errorCode };
    }
  }

  async claimNext(queue: string): Promise<{ id: string; queue: string; payload: unknown; attemptCount: number } | null> {
    const job = this.jobs.find((candidate) => candidate.queue === queue && !candidate.completed && !candidate.failed);
    return job === undefined ? null : { id: job.id, queue: job.queue, payload: job.payload, attemptCount: 1 };
  }

  async reclaimStale(): Promise<number> {
    return 0;
  }
}

class InMemoryStorage {
  private objects = new Map<string, Buffer>();

  async put(input: { key: string; contentType: string; body: Readable; expiresAt?: Date | null }) {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    this.objects.set(input.key, buffer);
    return { key: input.key, contentType: input.contentType, sizeBytes: buffer.length, sha256: "x", expiresAt: input.expiresAt ?? null };
  }

  async get(key: string) {
    const buffer = this.objects.get(key);
    if (buffer === undefined) throw new Error(`not found: ${key}`);
    return Readable.from(buffer);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(prefix: string) {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, contentType: "x", sizeBytes: 0, sha256: "x", expiresAt: null }));
  }
}

const resultDocument: AnalysisResult = {
  version: "1.0.0",
  title: "Договор аренды",
  documentType: "contract",
  detectedLanguages: ["ru"],
  outputLanguage: "ru",
  summary: "Резюме",
  simpleExplanation: "Объяснение",
  tasks: [],
  dates: [],
  amounts: [],
  locations: [],
  contacts: [],
  requiredDocuments: [],
  links: [],
  warnings: [],
  clarificationQuestions: [],
  overallConfidence: "high",
};

class FakeIngestion {
  files: ProcessedFile[] = [];
  calls: number[] = [];

  async ingest(files: InputEnvelope[], _manifest: unknown, _options: unknown) {
    this.calls.push(files.length);
    return { files: this.files, totalBytes: this.files.reduce((sum, file) => sum + file.sizeBytes, 0) };
  }
}

class FakeGateway {
  readonly inputs: AnalyzeDocumentInput[] = [];
  behavior: (input: AnalyzeDocumentInput) => Promise<AnalysisResult> = async () => resultDocument;

  async analyzeDocument(input: AnalyzeDocumentInput) {
    this.inputs.push(input);
    return this.behavior(input);
  }
}

const previewPolicy: PreviewPolicy = { mode: "no_preview", ttl: null };

function imageFile(stagingKey = "staging/processed/x.jpg"): ProcessedFile {
  return {
    index: 0,
    originalName: "doc.jpg",
    type: "image/jpeg",
    sha256: "abc",
    sizeBytes: 4,
    pageCount: 1,
    width: 10,
    height: 10,
    stagingKey,
    text: null,
    previews: [],
  };
}

function textFile(text: string): ProcessedFile {
  return {
    index: 0,
    originalName: "note.txt",
    type: "text/plain",
    sha256: "abc",
    sizeBytes: Buffer.byteLength(text),
    pageCount: null,
    width: null,
    height: null,
    stagingKey: null,
    text,
    previews: [],
  };
}

function build() {
  const repository = new InMemoryAnalysisRepository();
  const jobs = new InMemoryJobRepository();
  const events = new InMemoryAnalysisEventPublisher();
  const storage = new InMemoryStorage();
  const ingestion = new FakeIngestion();
  const gateway = new FakeGateway();
  const pipeline = new AnalysisPipeline({
    repository,
    jobs,
    events,
    ingestion,
    gateway,
    storage,
  });
  return { pipeline, repository, jobs, events, storage, ingestion, gateway };
}

function envelope(): InputEnvelope {
  return {
    index: 0,
    originalName: "doc.jpg",
    declaredMimeType: "image/jpeg",
    sizeBytes: 4,
    content: Readable.from(Buffer.from([1, 2, 3, 4])),
  };
}

async function createdAnalysis(pipeline: AnalysisPipeline) {
  return pipeline.createFromRequest({
    sessionId: "session-1",
    userId: null,
    sourceType: "image",
    documentType: "other",
    outputLanguage: "ru",
    explanationMode: "standard",
    retentionMode: "temporary",
    sourcePreviewMode: "no_preview",
    expiresAt: null,
  });
}

test("AnalysisPipeline: createFromRequest создаёт Analysis (queued) и job", async () => {
  const { pipeline, repository, jobs, events } = build();
  const { analysisId, jobId } = await createdAnalysis(pipeline);
  const record = await repository.get(analysisId);
  assert.ok(record !== null);
  assert.equal(record.status, "queued");
  assert.equal(record.stage, "queued");
  assert.equal(record.outputLanguage, "ru");
  assert.equal(jobs.jobs.length, 1);
  assert.deepEqual(jobs.jobs[0]?.payload, { analysisId });
  assert.equal(jobId, jobs.jobs[0]?.id);
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0]?.type, "analysis_created");
  assert.equal(events.events[0]?.id, 1);
});

test("AnalysisPipeline: execute проходит все стадии и удаляет временные данные", async () => {
  const { pipeline, repository, events, storage, ingestion, gateway } = build();
  ingestion.files = [imageFile("staging/processed/1.jpg"), imageFile("staging/processed/2.jpg")];
  await storage.put({ key: "staging/processed/1.jpg", contentType: "image/jpeg", body: Readable.from(Buffer.from([1, 2])) });
  await storage.put({ key: "staging/processed/2.jpg", contentType: "image/jpeg", body: Readable.from(Buffer.from([3, 4])) });
  const { analysisId } = await createdAnalysis(pipeline);

  const result = await pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });

  assert.equal(result?.title, "Договор аренды");
  const record = await repository.get(analysisId);
  assert.equal(record?.status, "completed");
  assert.equal(record?.stage, "completed");
  assert.equal(record?.progress, 100);
  assert.equal(record?.result?.title, "Договор аренды");
  assert.equal(record?.provider, "unknown");

  const stages = events.events.filter((event) => event.type === "stage_updated").map((event) => event.stage);
  assert.deepEqual(stages, STAGE_ORDER.filter((stage) => stage !== "queued"));
  assert.equal(events.events.some((event) => event.type === "completed"), true);
  const ids = events.events.map((event) => event.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "id событий монотонны");

  assert.equal((await storage.list("staging/")).length, 0, "временные данные удалены");
  assert.deepEqual(gateway.inputs[0]?.pages, [
    { index: 0, kind: "image", mimeType: "image/jpeg", content: Buffer.from([1, 2]) },
    { index: 0, kind: "image", mimeType: "image/jpeg", content: Buffer.from([3, 4]) },
  ]);
  assert.equal(gateway.inputs[0]?.language, "ru");
});

test("AnalysisPipeline: текст передаётся в AI без staging", async () => {
  const { pipeline, ingestion, gateway, storage, repository } = build();
  const text = "Собрание в 10:00";
  ingestion.files = [textFile(text)];
  const { analysisId } = await createdAnalysis(pipeline);
  await pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });
  assert.deepEqual(gateway.inputs[0]?.pages, [{ index: 0, kind: "text", mimeType: null, content: text }]);
  assert.equal((await storage.list("staging/")).length, 0);
  assert.equal((await repository.get(analysisId))?.status, "completed");
});

test("AnalysisPipeline: clarificationQuestions → needs_clarification, результат null", async () => {
  const ctx = build();
  ctx.ingestion.files = [imageFile("staging/processed/1.jpg")];
  await ctx.storage.put({
    key: "staging/processed/1.jpg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from([1, 2])),
  });
  ctx.gateway.behavior = async () => ({
    ...resultDocument,
    clarificationQuestions: [
      { fieldPath: "dates", question: "Какая дата окончания?", suggestedAnswers: [], required: true },
    ],
  });
  const { analysisId } = await createdAnalysis(ctx.pipeline);
  const result = await ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });
  assert.equal(result, null);
  const record = await ctx.repository.get(analysisId);
  assert.equal(record?.status, "needs_clarification");
  assert.equal(ctx.events.events.some((event) => event.type === "clarification_required"), true);
  assert.equal((await ctx.storage.list("staging/")).length, 0);
});

test("AnalysisPipeline: ошибка AI → failed + событие + cleanup", async () => {
  const ctx = build();
  ctx.ingestion.files = [imageFile("staging/processed/1.jpg")];
  await ctx.storage.put({
    key: "staging/processed/1.jpg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from([1, 2])),
  });
  ctx.gateway.behavior = async () => {
    throw new AppError({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
  };
  const { analysisId } = await createdAnalysis(ctx.pipeline);
  await assert.rejects(
    ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy }),
    (error: unknown) => error instanceof AppError && error.code === "AI_PROVIDER_TIMEOUT"
  );
  const record = await ctx.repository.get(analysisId);
  assert.equal(record?.status, "failed");
  assert.equal(record?.errorCode, "AI_PROVIDER_TIMEOUT");
  const failed = ctx.events.events.find((event) => event.type === "failed");
  assert.equal(failed?.payload?.errorCode, "AI_PROVIDER_TIMEOUT");
  assert.equal((await ctx.storage.list("staging/")).length, 0);
});

test("AnalysisPipeline: cancel во время analyzing прерывает вызов", async () => {
  const ctx = build();
  ctx.ingestion.files = [imageFile("staging/processed/1.jpg")];
  await ctx.storage.put({
    key: "staging/processed/1.jpg",
    contentType: "image/jpeg",
    body: Readable.from(Buffer.from([1, 2])),
  });
  let aborted = false;
  ctx.gateway.behavior = (input) =>
    new Promise((_resolve, reject) => {
      input.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new AppError({ code: "AI_PROVIDER_TIMEOUT", retryable: true }));
      });
    });
  const { analysisId } = await createdAnalysis(ctx.pipeline);

  const executePromise = ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cancelled = await ctx.pipeline.cancel(analysisId, "пользователь передумал");
  assert.equal(cancelled, true);

  await assert.rejects(executePromise);
  assert.equal(aborted, true);
  const record = await ctx.repository.get(analysisId);
  assert.equal(record?.status, "cancelled");
  const cancelledEvent = ctx.events.events.find((event) => event.type === "cancelled");
  assert.equal(cancelledEvent?.payload?.reason, "пользователь передумал");
  assert.equal(
    ctx.events.events.filter((event) => event.type === "cancelled").length,
    1,
    "событие cancelled публикуется один раз"
  );
  assert.equal((await ctx.storage.list("staging/")).length, 0);
});

test("AnalysisPipeline: cancel завершённого анализа возвращает false", async () => {
  const ctx = build();
  ctx.ingestion.files = [textFile("Собрание в 10:00")];
  const { analysisId } = await createdAnalysis(ctx.pipeline);
  await ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });
  assert.equal(await ctx.pipeline.cancel(analysisId), false);
});

test("AnalysisPipeline: повторный execute завершённого анализа отклоняется", async () => {
  const ctx = build();
  ctx.ingestion.files = [textFile("Собрание в 10:00")];
  const { analysisId } = await createdAnalysis(ctx.pipeline);
  await ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy });
  await assert.rejects(
    ctx.pipeline.execute({ analysisId, files: [envelope()], manifest: null, previewPolicy }),
    (error: unknown) => error instanceof AppError && error.code === "ANALYSIS_NOT_READY"
  );
});

test("AnalysisPipeline: несуществующий анализ → NOT_FOUND", async () => {
  const ctx = build();
  await assert.rejects(
    ctx.pipeline.execute({ analysisId: "missing", files: [envelope()], manifest: null, previewPolicy }),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});
