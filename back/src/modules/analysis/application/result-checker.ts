import type { AnalysisResult } from "../../../validation/ai/analysis-result";

export interface CheckResult {
  ok: boolean;
  requiresClarification: boolean;
  issues: string[];
}

export class ResultChecker {
  check(result: AnalysisResult): CheckResult {
    const issues: string[] = [];
    if (result.detectedLanguages.length === 0) {
      issues.push("detectedLanguages пуст");
    }
    if (result.overallConfidence === "low" && result.warnings.length === 0) {
      issues.push("overallConfidence=low без предупреждений");
    }
    const requiresClarification =
      result.clarificationQuestions.length > 0 ||
      result.tasks.some((task) => task.requiresClarification);
    return {
      ok: issues.length === 0,
      requiresClarification,
      issues,
    };
  }
}
