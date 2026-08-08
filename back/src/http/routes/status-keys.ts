import { messageKeyFor } from "../../shared/errors";
import type { ErrorCode } from "../../validation/response/error";
import type { AnalysisRecord } from "../../modules/analysis/application/analysis-repository";

export function messageKeyForStatus(record: AnalysisRecord): string {
  if (record.status === "failed") {
    if (record.errorCode !== null) {
      return messageKeyFor(record.errorCode as ErrorCode);
    }
    return "errors.internalError";
  }
  if (record.status === "cancelled") {
    return "errors.analysisCancelled";
  }
  if (record.status === "completed") {
    return "events.analysis.completed";
  }
  if (record.status === "needs_clarification") {
    return "events.analysis.clarificationRequired";
  }
  return `events.analysis.stage.${record.stage}`;
}
