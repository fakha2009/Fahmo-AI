import { randomUUID } from "node:crypto";
import { AppError, messageKeyFor } from "../../../shared/errors";
import { streamToBuffer } from "../../../shared/utils/stream";
import type { AnalysisResult } from "../../../validation/ai/analysis-result";
import type {
  AnalysisStage,
  AnalysisStatus,
  DocumentType,
  ExplanationMode,
  OutputLanguage,
  RetentionMode,
  SourcePreviewMode,
  SourceType,
} from "../../../validation/common";
import type { InputManifest } from "../../../validation/request/manifest";
import type { AiGateway } from "../../../ai/gateway/ai-gateway";
import type { IngestionService } from "../../ingestion/application/ingestion-service";
import type {
  InputEnvelope,
  PreviewPolicy,
  ProcessedFile,
} from "../../ingestion/domain/types";
import type { StoragePort } from "../../../storage/contracts/storage-port";
import type { SourceAssetService } from "../../preview/application/source-asset-service";
import { STAGE_PROGRESS, AnalysisCancelledError } from "../domain/stages";
import type { AnalysisEventType } from "./analysis-event-publisher";
import type { AnalysisRepository } from "./analysis-repository";
import type { AnalysisEventPublisher } from "./analysis-event-publisher";
import type { JobRepository } from "./job-repository";
import { ResultChecker } from "./result-checker";

export interface CreateAnalysisRequest {
  sessionId: string | null;
  userId: string | null;
  sourceType: SourceType;
  documentType: DocumentType;
  outputLanguage: OutputLanguage;
  explanationMode: ExplanationMode;
  retentionMode: RetentionMode;
  sourcePreviewMode: SourcePreviewMode;
  expiresAt: Date | null;
  idempotencyKey?: string | null;
}

export interface ExecuteAnalysisRequest {
  analysisId: string;
  files: InputEnvelope[];
  manifest: InputManifest | null;
  previewPolicy: PreviewPolicy;
  expiresAt?: Date | null;
  promptDocumentType?: DocumentType | null;
  promptVersion?: string | null;
}

export interface PipelineDependencies {
  repository: AnalysisRepository;
  jobs: JobRepository;
  events: AnalysisEventPublisher;
  ingestion: Pick<IngestionService, "ingest">;
  gateway: Pick<AiGateway, "analyzeDocument">;
  storage: StoragePort;
  assets?: SourceAssetService;
  checker?: ResultChecker;
}

export const ANALYSIS_QUEUE = "analysis";
export const RESULT_REVISION = 1;

export class AnalysisPipeline {
  private readonly checker: ResultChecker;
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: PipelineDependencies) {
    this.checker = deps.checker ?? new ResultChecker();
  }

  async createFromRequest(
    input: CreateAnalysisRequest
  ): Promise<{ analysisId: string; jobId: string }> {
    const analysisId = randomUUID();
    const record = await this.deps.repository.create({
      id: analysisId,
      sessionId: input.sessionId,
      userId: input.userId,
      sourceType: input.sourceType,
      documentType: input.documentType,
      outputLanguage: input.outputLanguage,
      explanationMode: input.explanationMode,
      retentionMode: input.retentionMode,
      sourcePreviewMode: input.sourcePreviewMode,
      expiresAt: input.expiresAt,
    });
    const job = await this.deps.jobs.enqueue(
      ANALYSIS_QUEUE,
      { analysisId },
      { dedupKey: input.idempotencyKey ?? null }
    );
    await this.publish(record.id, "analysis_created", "queued", 0, {
      jobId: job.id,
    });
    return { analysisId, jobId: job.id };
  }

  async execute(input: ExecuteAnalysisRequest): Promise<AnalysisResult | null> {
    const record = await this.deps.repository.get(input.analysisId);
    if (record === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
    }
    if (record.status !== "queued" && record.status !== "processing") {
      throw new AppError({
        code: "ANALYSIS_NOT_READY",
        message: "Анализ уже завершён или отменён",
        params: { status: record.status },
      });
    }

    const controller = new AbortController();
    this.controllers.set(input.analysisId, controller);
    let stagedKeys: string[] = [];
    try {
      await this.setStatus(record.id, "processing");
      await this.enterStage(record.id, "validating");

      await this.enterStage(record.id, "preparing_files");
      const processed = await this.deps.ingestion.ingest(
        input.files,
        input.manifest,
        {
          previewPolicy: input.previewPolicy,
          expiresAt: input.expiresAt ?? null,
        }
      );
      stagedKeys = processed.files
        .map((file) => file.stagingKey)
        .filter((key): key is string => key !== null);

      if (this.deps.assets !== undefined) {
        const previews = processed.files.flatMap((file) => file.previews);
        if (previews.length > 0) {
          await this.deps.assets.save(record.id, previews);
        }
      }

      await this.enterStage(record.id, "extracting_content");
      const pages = await this.buildPages(processed.files);

      await this.enterStage(record.id, "detecting_document_type");
      const promptDocumentType = input.promptDocumentType ?? null;

      await this.enterStage(record.id, "analyzing");
      const result = await this.deps.gateway.analyzeDocument({
        analysisId: record.id,
        language: record.outputLanguage,
        inputType: record.sourceType === "pdf" ? "pdf" : "image",
        pages,
        signal: controller.signal,
        promptDocumentType,
        promptVersion: input.promptVersion ?? null,
      });

      await this.enterStage(record.id, "checking_result");
      const check = this.checker.check(result);
      if (check.requiresClarification) {
        const partial = this.normalize(result, record.outputLanguage);
        await this.deps.repository.saveResult(record.id, {
          result: partial,
          detectedLanguages: partial.detectedLanguages,
          provider: record.provider ?? "unknown",
          model: record.model ?? "unknown",
          overallConfidence: partial.overallConfidence,
          revision: RESULT_REVISION,
        });
        await this.cleanupStaged(stagedKeys);
        stagedKeys = [];
        await this.setStatus(record.id, "needs_clarification");
        await this.publish(record.id, "clarification_required", "checking_result", 80, {
          questionCount: result.clarificationQuestions.length,
          requiresClarificationTasks: result.tasks.filter(
            (task) => task.requiresClarification
          ).length,
        });
        return null;
      }

      await this.enterStage(record.id, "normalizing");
      const normalized = this.normalize(result, record.outputLanguage);

      await this.enterStage(record.id, "saving");
      await this.deps.repository.saveResult(record.id, {
        result: normalized,
        detectedLanguages: normalized.detectedLanguages,
        provider: record.provider ?? "unknown",
        model: record.model ?? "unknown",
        overallConfidence: normalized.overallConfidence,
        revision: RESULT_REVISION,
      });

      await this.cleanupStaged(stagedKeys);
      stagedKeys = [];

      await this.setStatus(record.id, "completed", { completedAt: new Date() });
      await this.enterStage(record.id, "completed");
      await this.publish(record.id, "completed", "completed", 100, null);
      return normalized;
    } catch (error) {
      await this.cleanupStaged(stagedKeys);
      if (controller.signal.aborted || error instanceof AnalysisCancelledError) {
        await this.publishIfNotCancelled(record.id, error);
      } else {
        const appError =
          error instanceof AppError ? error : new AppError({ code: "INTERNAL_ERROR", cause: error });
        await this.setStatus(record.id, "failed", { errorCode: appError.code });
        await this.publish(record.id, "failed", record.stage, record.progress ?? 0, {
          errorCode: appError.code,
        }, messageKeyFor(appError.code));
      }
      throw error;
    } finally {
      this.controllers.delete(input.analysisId);
    }
  }

  /**
   * Прерывает выполняющийся вызов (используется worker-циклом при отмене,
   * пришедшей из другого процесса: cancel() → статус CANCELLED в БД →
   * polling воркера → abort локального AbortController).
   */
  abortExecution(analysisId: string): boolean {
    const controller = this.controllers.get(analysisId);
    if (controller === undefined) {
      return false;
    }
    controller.abort();
    return true;
  }

  async cancel(analysisId: string, reason: string | null = null): Promise<boolean> {
    const record = await this.deps.repository.get(analysisId);
    if (record === null) {
      return false;
    }
    if (record.status !== "queued" && record.status !== "processing") {
      return false;
    }
    this.controllers.get(analysisId)?.abort();
    await this.deps.repository.updateStatus(analysisId, "cancelled");
    await this.publish(analysisId, "cancelled", record.stage, record.progress ?? 0, {
      reason,
    });
    return true;
  }

  private async publishIfNotCancelled(analysisId: string, error: unknown): Promise<void> {
    const record = await this.deps.repository.get(analysisId);
    if (record === null || record.status === "cancelled") {
      return;
    }
    const appError =
      error instanceof AppError ? error : new AppError({ code: "INTERNAL_ERROR", cause: error });
    await this.setStatus(analysisId, "failed", { errorCode: appError.code });
    await this.publish(analysisId, "failed", record.stage, record.progress ?? 0, {
      errorCode: appError.code,
    });
  }

  private async buildPages(files: ProcessedFile[]): Promise<
    { index: number; kind: "image" | "text"; mimeType: string | null; content: string | Uint8Array }[]
  > {
    const pages: { index: number; kind: "image" | "text"; mimeType: string | null; content: string | Uint8Array }[] = [];
    for (const file of files) {
      if (file.text !== null) {
        pages.push({ index: file.index, kind: "text", mimeType: null, content: file.text });
        continue;
      }
      if (file.stagingKey === null) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "Файл без контента не может быть передан AI",
          params: { fileIndex: file.index },
        });
      }
      const stream = await this.deps.storage.get(file.stagingKey);
      const buffer = await streamToBuffer(stream);
      pages.push({
        index: file.index,
        kind: "image",
        mimeType: file.type === "application/pdf" ? "application/pdf" : file.type,
        content: buffer,
      });
    }
    return pages;
  }

  private normalize(result: AnalysisResult, language: OutputLanguage): AnalysisResult {
    return {
      ...result,
      outputLanguage: language,
    };
  }

  private async cleanupStaged(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.deps.storage.delete(key).catch(() => undefined);
    }
  }

  private async enterStage(analysisId: string, stage: AnalysisStage): Promise<void> {
    const progress = STAGE_PROGRESS[stage];
    const record = await this.deps.repository.updateStage(analysisId, stage, progress);
    if (record === null || record.status === "cancelled" || record.status === "failed") {
      throw new AnalysisCancelledError();
    }
    await this.publish(analysisId, "stage_updated", stage, progress, null);
  }

  private async setStatus(
    analysisId: string,
    status: AnalysisStatus,
    patch?: { errorCode?: string | null; completedAt?: Date | null }
  ): Promise<void> {
    const record = await this.deps.repository.updateStatus(analysisId, status, patch);
    if (record === null) {
      throw new AnalysisCancelledError();
    }
  }

  private async publish(
    analysisId: string,
    type: AnalysisEventType,
    stage: AnalysisStage,
    progress: number,
    payload: Record<string, unknown> | null,
    messageKey?: string | null
  ): Promise<void> {
    await this.deps.events.publish({ analysisId, type, stage, progress, payload, messageKey });
  }
}
