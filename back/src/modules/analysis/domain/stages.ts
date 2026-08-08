import type { AnalysisStage } from "../../../validation/common";

export const STAGE_ORDER: readonly AnalysisStage[] = [
  "queued",
  "validating",
  "preparing_files",
  "extracting_content",
  "detecting_document_type",
  "analyzing",
  "checking_result",
  "normalizing",
  "saving",
  "completed",
];

export const STAGE_PROGRESS: Record<AnalysisStage, number> = {
  queued: 0,
  validating: 5,
  preparing_files: 20,
  extracting_content: 35,
  detecting_document_type: 45,
  analyzing: 60,
  checking_result: 80,
  normalizing: 90,
  saving: 95,
  completed: 100,
};

export function stageIndex(stage: AnalysisStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export class AnalysisCancelledError extends Error {
  constructor() {
    super("Анализ отменён");
    this.name = "AnalysisCancelledError";
  }
}

export function isAnalysisCancelledError(error: unknown): error is AnalysisCancelledError {
  return error instanceof AnalysisCancelledError;
}
