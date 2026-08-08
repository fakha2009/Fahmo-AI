import { AppError } from "../../../shared/errors";
import type { AnalysisStage, AnalysisStatus } from "../../../validation/common";
import type { AnalysisRepository } from "./analysis-repository";
import type { AnalysisPipeline } from "./analysis-pipeline";

export interface AnalysisStatusOutput {
  analysisId: string;
  status: AnalysisStatus;
  stage: AnalysisStage;
  progress: number;
  errorCode: string | null;
}

export interface AnalysisControllerDeps {
  pipeline: AnalysisPipeline;
  repository: AnalysisRepository;
}

/**
 * Контроллер без HTTP-зависимостей: status/cancel.
 * В HTTP-слое добавляется аутентификация и владение анализом;
 * SSE-поток подключается там же через createAnalysisSseStream.
 */
export class AnalysisController {
  constructor(private readonly deps: AnalysisControllerDeps) {}

  async getStatus(analysisId: string): Promise<AnalysisStatusOutput> {
    const record = await this.deps.repository.get(analysisId);
    if (record === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
    }
    return {
      analysisId: record.id,
      status: record.status,
      stage: record.stage,
      progress: record.progress ?? 0,
      errorCode: record.errorCode,
    };
  }

  /**
   * Cancel endpoint: анализы в queued/processing → CANCELLED + событие.
   * Возвращает true при отмене; завершённый/отсутствующий анализ — ошибка.
   */
  async cancel(analysisId: string, reason: string | null = null): Promise<boolean> {
    const record = await this.deps.repository.get(analysisId);
    if (record === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Анализ не найден" });
    }
    const cancelled = await this.deps.pipeline.cancel(analysisId, reason);
    if (!cancelled) {
      throw new AppError({
        code: "ANALYSIS_NOT_READY",
        message: "Анализ уже завершён или отменён",
        params: { status: record.status },
      });
    }
    return true;
  }
}
