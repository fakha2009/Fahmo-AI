import { z } from "zod";
import { AnalysisResultSchema } from "../../../validation/ai/analysis-result";

export const ShareSnapshotSchema = AnalysisResultSchema.omit({
  clarificationQuestions: true,
  overallConfidence: true,
});

export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;

export interface ShareRecord {
  id: string;
  analysisId: string;
  tokenHash: string;
  snapshot: ShareSnapshot;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  lastViewedAt: Date | null;
  viewCount: number;
}

export function createShareSnapshot(result: z.infer<typeof AnalysisResultSchema>): ShareSnapshot {
  const { clarificationQuestions, overallConfidence, ...snapshot } = result;
  return ShareSnapshotSchema.parse(snapshot);
}
