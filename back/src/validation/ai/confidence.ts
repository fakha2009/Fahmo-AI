import type { ConfidenceLevel } from "../common";

export const ConfidenceRank: Readonly<Record<ConfidenceLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function combineConfidence(levels: readonly ConfidenceLevel[]): ConfidenceLevel {
  let worst: ConfidenceLevel = "high";
  for (const level of levels) {
    if (ConfidenceRank[level] < ConfidenceRank[worst]) {
      worst = level;
    }
  }
  return worst;
}

export function dateConfidenceRule(
  isoDate: string | null,
  isoDateTime: string | null,
  isApproximate: boolean,
  confidence: ConfidenceLevel
): boolean {
  if (isoDate === null && isoDateTime === null) {
    return confidence !== "high";
  }
  if (isApproximate) {
    return confidence !== "high";
  }
  return true;
}

export function amountConfidenceRule(
  value: string | null,
  confidence: ConfidenceLevel
): boolean {
  if (value === null) {
    return confidence !== "high";
  }
  return true;
}

export function overallConfidence(input: {
  taskLevels: readonly ConfidenceLevel[];
  dateLevels: readonly ConfidenceLevel[];
  amountLevels: readonly ConfidenceLevel[];
  hasCriticalWarning: boolean;
  userConfirmed: boolean;
}): ConfidenceLevel {
  let level = combineConfidence([
    ...input.taskLevels,
    ...input.dateLevels,
    ...input.amountLevels,
  ]);
  if (input.hasCriticalWarning && ConfidenceRank[level] > ConfidenceRank.medium) {
    level = "medium";
  }
  if (!input.userConfirmed && level === "high") {
    level = "medium";
  }
  return level;
}
