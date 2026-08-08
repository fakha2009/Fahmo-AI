import { AppError, toAppError } from "../../../shared/errors";
import type { StoragePort } from "../../../storage/contracts/storage-port";
import type { AnalysisPipeline } from "./analysis-pipeline";
import { ANALYSIS_QUEUE } from "./analysis-pipeline";
import type { AnalysisInputRepository } from "./analysis-input-repository";
import { toInputEnvelopes } from "./analysis-input-repository";
import type { AnalysisRecord, AnalysisRepository } from "./analysis-repository";
import type { ClaimedJob, JobRepository } from "./job-repository";
import { previewPolicyFor } from "../../preview/domain/policy";

export const WORKER_DEFAULT_POLL_MS = 2_000;
export const WORKER_DEFAULT_CANCEL_POLL_MS = 1_500;
export const WORKER_DEFAULT_STALE_MS = 10 * 60 * 1000;
export const WORKER_DEFAULT_MAX_JOBS_PER_RUN = 10;

export interface AnalysisWorkerDeps {
  pipeline: AnalysisPipeline;
  repository: AnalysisRepository;
  inputs: AnalysisInputRepository;
  jobs: JobRepository;
  storage: StoragePort;
  queue?: string;
  pollIntervalMs?: number;
  cancelPollIntervalMs?: number;
  staleAfterMs?: number;
  maxJobsPerRun?: number;
  onCompleted?: (analysis: AnalysisRecord) => Promise<void>;
}

export interface AnalysisWorkerRunReport {
  processed: number;
}

/**
 * Фоновый исполнитель очереди `analysis`.
 * Жизненный цикл: claimNext (QUEUED→RUNNING) → регидрация входов из AnalysisInputMetadata
 * → AnalysisPipeline.execute → complete/fail. Отмена из API-процесса видна через polling
 * статуса анализа (CANCELLED) и прерывает выполнение через abortExecution.
 */
export class AnalysisWorker {
  private readonly queue: string;
  private readonly pollIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly maxJobsPerRun: number;

  constructor(private readonly deps: AnalysisWorkerDeps) {
    this.queue = deps.queue ?? ANALYSIS_QUEUE;
    this.pollIntervalMs = deps.pollIntervalMs ?? WORKER_DEFAULT_POLL_MS;
    this.cancelPollIntervalMs = deps.cancelPollIntervalMs ?? WORKER_DEFAULT_CANCEL_POLL_MS;
    this.staleAfterMs = deps.staleAfterMs ?? WORKER_DEFAULT_STALE_MS;
    this.maxJobsPerRun = deps.maxJobsPerRun ?? WORKER_DEFAULT_MAX_JOBS_PER_RUN;
  }

  async runOnce(): Promise<AnalysisWorkerRunReport> {
    let processed = 0;
    while (processed < this.maxJobsPerRun) {
      const job = await this.deps.jobs.claimNext(this.queue);
      if (job === null) {
        break;
      }
      await this.runJob(job);
      processed += 1;
    }
    return { processed };
  }

  async runForever(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.deps.jobs.reclaimStale(this.queue, new Date(Date.now() - this.staleAfterMs));
      const job = await this.deps.jobs.claimNext(this.queue);
      if (job === null) {
        await sleep(this.pollIntervalMs, signal);
        continue;
      }
      await this.runJob(job);
    }
  }

  private async runJob(job: ClaimedJob): Promise<void> {
    const analysisId = extractAnalysisId(job.payload);
    if (analysisId === null) {
      await this.deps.jobs.fail(job.id, "INVALID_JOB_PAYLOAD", "payload должен содержать analysisId");
      return;
    }

    try {
      const analysis = await this.deps.repository.get(analysisId);
      if (analysis === null) {
        throw new AppError({
          code: "NOT_FOUND",
          message: "Анализ не найден",
          params: { analysisId },
        });
      }
      const inputs = await this.deps.inputs.listForAnalysis(analysisId);
      if (inputs.length === 0) {
        throw new AppError({
          code: "NOT_FOUND",
          message: "Входные данные анализа не сохранены",
          params: { analysisId },
        });
      }
      const envelopes = await toInputEnvelopes(inputs, this.deps.storage);

      const watcher = setInterval(() => {
        void this.checkCancellation(analysisId, watcher);
      }, this.cancelPollIntervalMs);
      try {
        await this.deps.pipeline.execute({
          analysisId,
          files: envelopes,
          manifest: null,
          previewPolicy: previewPolicyFor(analysis.sourcePreviewMode),
        });
      } finally {
        clearInterval(watcher);
      }

      const record = await this.deps.repository.get(analysisId);
      if (record !== null && record.status === "cancelled") {
        await this.deps.jobs.complete(job.id);
        return;
      }
      if (record !== null && record.status === "completed") {
        await this.deps.onCompleted?.(record);
      }
      await this.deps.jobs.complete(job.id);
    } catch (error) {
      const appError = toAppError(error);
      const record = await this.deps.repository.get(analysisId).catch(() => null);
      if (record !== null && record.status === "cancelled") {
        await this.deps.jobs.complete(job.id);
        return;
      }
      await this.deps.jobs.fail(job.id, appError.code, appError.message);
    }
  }

  private async checkCancellation(analysisId: string, watcher: NodeJS.Timeout): Promise<void> {
    try {
      const record = await this.deps.repository.get(analysisId);
      if (record === null) {
        return;
      }
      if (record.status !== "queued" && record.status !== "processing" && record.status !== "validating") {
        clearInterval(watcher);
        this.deps.pipeline.abortExecution(analysisId);
      }
    } catch {
      // polling не должен ронять воркер
    }
  }
}

function extractAnalysisId(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const value = (payload as Record<string, unknown>).analysisId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
