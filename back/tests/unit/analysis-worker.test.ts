import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AppError } from "../../src/shared/errors";
import { AnalysisWorker } from "../../src/modules/analysis/application/analysis-worker";
import type { AnalysisInputRecord, AnalysisInputRepository } from "../../src/modules/analysis/application/analysis-input-repository";
import type { AnalysisRecord, AnalysisRepository } from "../../src/modules/analysis/application/analysis-repository";
import type { ClaimedJob, JobRepository } from "../../src/modules/analysis/application/job-repository";
import type { ExecuteAnalysisRequest } from "../../src/modules/analysis/application/analysis-pipeline";

const ANALYSIS_QUEUE = "analysis";

class FakeAnalysisRepository implements AnalysisRepository {
  private records = new Map<string, AnalysisRecord>();

  seed(id: string, status: AnalysisRecord["status"]) {
    this.records.set(id, {
      id,
      sessionId: null,
      userId: null,
      status,
      stage: "queued",
      progress: 0,
      sourceType: "text",
      documentType: "other",
      outputLanguage: "ru",
      retentionMode: "temporary",
      sourcePreviewMode: "temporary",
      result: null,
      detectedLanguages: [],
      provider: null,
      model: null,
      errorCode: null,
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    });
  }

  setStatus(id: string, status: AnalysisRecord["status"]) {
    const record = this.records.get(id);
    if (record !== undefined) record.status = status;
  }

  async create(): Promise<AnalysisRecord> {
    throw new Error("not implemented");
  }
  async get(id: string): Promise<AnalysisRecord | null> {
    return this.records.get(id) ?? null;
  }
  async listByOwner(): Promise<AnalysisRecord[]> {
    return [];
  }
  async updateStage(): Promise<AnalysisRecord | null> {
    return null;
  }
  async updateStatus(): Promise<AnalysisRecord | null> {
    return null;
  }
  async saveResult(): Promise<void> {}
  async updateFields(): Promise<never> {
    throw new Error("not implemented");
  }
}

class FakeInputRepository implements AnalysisInputRepository {
  private inputs = new Map<string, AnalysisInputRecord[]>();

  seed(analysisId: string, inputs: AnalysisInputRecord[]) {
    this.inputs.set(analysisId, inputs);
  }

  async saveForAnalysis(): Promise<void> {}
  async listForAnalysis(analysisId: string): Promise<AnalysisInputRecord[]> {
    return this.inputs.get(analysisId) ?? [];
  }
}

class FakeStorage {
  async get(key: string): Promise<Readable> {
    return Readable.from(Buffer.from("content of " + key));
  }
}

class FakeJobs implements JobRepository {
  readonly queue: { id: string; payload: unknown; completed: boolean; failed: string | null }[] = [];
  private counter = 0;
  reclaims: Date[] = [];

  push(payload: unknown) {
    this.counter += 1;
    this.queue.push({ id: `job-${this.counter}`, payload, completed: false, failed: null });
  }

  async enqueue(): Promise<never> {
    throw new Error("not implemented");
  }
  async complete(id: string) {
    const job = this.queue.find((candidate) => candidate.id === id);
    if (job !== undefined) job.completed = true;
  }
  async fail(id: string, errorCode: string) {
    const job = this.queue.find((candidate) => candidate.id === id);
    if (job !== undefined) job.failed = errorCode;
  }
  async claimNext(): Promise<ClaimedJob | null> {
    const job = this.queue.find((candidate) => !candidate.completed && candidate.failed === null);
    return job === undefined ? null : { id: job.id, queue: ANALYSIS_QUEUE, payload: job.payload, attemptCount: 1 };
  }
  async reclaimStale(): Promise<number> {
    return 0;
  }
}

class FakePipeline {
  behavior: ((input: ExecuteAnalysisRequest) => Promise<unknown>) | null = null;
  abortHandler: (() => void) | null = null;
  aborted = false;
  readonly executeCalls: ExecuteAnalysisRequest[] = [];

  async execute(input: ExecuteAnalysisRequest): Promise<unknown> {
    this.executeCalls.push(input);
    if (this.behavior !== null) {
      return this.behavior(input);
    }
    return new Promise((_resolve, reject) => {
      this.abortHandler = () => {
        this.aborted = true;
        reject(new AppError({ code: "ANALYSIS_CANCELLED", message: "Анализ отменён" }));
      };
    });
  }

  abortExecution(): boolean {
    this.abortHandler?.();
    return true;
  }
}

function build() {
  const repository = new FakeAnalysisRepository();
  const inputs = new FakeInputRepository();
  const storage = new FakeStorage();
  const jobs = new FakeJobs();
  const pipeline = new FakePipeline();
  const worker = new AnalysisWorker({
    pipeline: pipeline as never,
    repository,
    inputs,
    jobs,
    storage: storage as never,
    cancelPollIntervalMs: 10,
    pollIntervalMs: 10,
  });
  return { repository, inputs, jobs, pipeline, worker };
}

function textInput(text: string): AnalysisInputRecord {
  return {
    index: 0,
    originalName: "note.txt",
    mimeType: "text/plain",
    sizeBytes: Buffer.byteLength(text),
    stagingKey: null,
    textContent: text,
  };
}

function stagedInput(): AnalysisInputRecord {
  return {
    index: 0,
    originalName: "doc.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 4,
    stagingKey: "staging/inputs/doc.jpg",
    textContent: null,
  };
}

test("AnalysisWorker: успешное выполнение → complete + регидрация входов", async () => {
  const { repository, inputs, jobs, pipeline, worker } = build();
  repository.seed("a1", "queued");
  inputs.seed("a1", [textInput("Собрание в 10:00")]);
  jobs.push({ analysisId: "a1" });
  pipeline.behavior = async () => ({ ok: true });

  const report = await worker.runOnce();
  assert.equal(report.processed, 1);
  assert.equal(jobs.queue[0]?.completed, true);
  assert.equal(jobs.queue[0]?.failed, null);
  assert.equal(pipeline.executeCalls.length, 1);
  assert.equal(pipeline.executeCalls[0]?.analysisId, "a1");
  assert.equal(pipeline.executeCalls[0]?.files.length, 1);
  assert.equal(pipeline.executeCalls[0]?.files[0]?.index, 0);
  assert.equal(pipeline.executeCalls[0]?.manifest, null);
  assert.deepEqual(pipeline.executeCalls[0]?.previewPolicy, { mode: "temporary", ttl: { hours: 24 } });
});

test("AnalysisWorker: ошибка выполнения → fail с кодом", async () => {
  const { repository, inputs, jobs, pipeline, worker } = build();
  repository.seed("a1", "queued");
  inputs.seed("a1", [textInput("Текст")]);
  jobs.push({ analysisId: "a1" });
  pipeline.behavior = async () => {
    throw new AppError({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
  };

  await worker.runOnce();
  assert.equal(jobs.queue[0]?.completed, false);
  assert.equal(jobs.queue[0]?.failed, "AI_PROVIDER_TIMEOUT");
});

test("AnalysisWorker: payload без analysisId → fail INVALID_JOB_PAYLOAD", async () => {
  const { jobs, worker } = build();
  jobs.push({ foo: "bar" });
  await worker.runOnce();
  assert.equal(jobs.queue[0]?.failed, "INVALID_JOB_PAYLOAD");
});

test("AnalysisWorker: нет входных данных → fail NOT_FOUND", async () => {
  const { repository, jobs, worker } = build();
  repository.seed("a1", "queued");
  jobs.push({ analysisId: "a1" });
  await worker.runOnce();
  assert.equal(jobs.queue[0]?.failed, "NOT_FOUND");
});

test("AnalysisWorker: отмена через polling прерывает выполнение и завершает job", async () => {
  const { repository, inputs, jobs, pipeline, worker } = build();
  repository.seed("a1", "queued");
  inputs.seed("a1", [stagedInput()]);
  jobs.push({ analysisId: "a1" });

  const runPromise = worker.runOnce();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(pipeline.executeCalls.length, 1, "execute запущен до отмены");
  repository.setStatus("a1", "cancelled");
  await runPromise;

  assert.equal(pipeline.aborted, true, "AbortController прерван polling-воркером");
  assert.equal(jobs.queue[0]?.completed, true, "отменённый джоб завершается, а не фейлится");
  assert.equal(jobs.queue[0]?.failed, null);
});

test("AnalysisWorker: обработка нескольких джобов за один проход", async () => {
  const { repository, inputs, jobs, pipeline, worker } = build();
  repository.seed("a1", "queued");
  repository.seed("a2", "queued");
  inputs.seed("a1", [textInput("Первый")]);
  inputs.seed("a2", [textInput("Второй")]);
  jobs.push({ analysisId: "a1" });
  jobs.push({ analysisId: "a2" });
  pipeline.behavior = async () => ({ ok: true });

  const report = await worker.runOnce();
  assert.equal(report.processed, 2);
  assert.equal(jobs.queue.every((job) => job.completed), true);
});

test("AnalysisWorker: runForever крутится и останавливается по signal", async () => {
  const { repository, inputs, jobs, pipeline, worker } = build();
  repository.seed("a1", "queued");
  inputs.seed("a1", [textInput("Текст")]);
  jobs.push({ analysisId: "a1" });
  pipeline.behavior = async () => ({ ok: true });

  const controller = new AbortController();
  const forever = worker.runForever(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await forever;
  assert.equal(jobs.queue[0]?.completed, true);
});
