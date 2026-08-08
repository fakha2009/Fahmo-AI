import type {
  AnalysisStage,
  AnalysisStatus,
  ConfidenceLevel,
  DocumentType,
  ExplanationMode,
  OutputLanguage,
  RetentionMode,
  SourcePreviewMode,
  SourceType,
} from "../../../validation/common";
import type { AnalysisResult } from "../../../validation/ai/analysis-result";

export interface AnalysisCreateInput {
  id: string;
  sessionId: string | null;
  userId: string | null;
  sourceType: SourceType;
  documentType: DocumentType;
  outputLanguage: OutputLanguage;
  explanationMode: ExplanationMode;
  retentionMode: RetentionMode;
  sourcePreviewMode: SourcePreviewMode;
  expiresAt: Date | null;
}

export interface AnalysisRecord {
  id: string;
  sessionId: string | null;
  userId: string | null;
  status: AnalysisStatus;
  stage: AnalysisStage;
  progress: number | null;
  sourceType: SourceType;
  documentType: DocumentType;
  outputLanguage: OutputLanguage;
  retentionMode: RetentionMode;
  sourcePreviewMode: SourcePreviewMode;
  result: AnalysisResult | null;
  detectedLanguages: string[];
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface SaveResultInput {
  result: AnalysisResult;
  detectedLanguages: string[];
  provider: string;
  model: string;
  overallConfidence: ConfidenceLevel;
  revision: number;
}

export interface AnalysisUpdatePatch {
  outputLanguage?: OutputLanguage;
  explanationMode?: ExplanationMode;
  retentionMode?: RetentionMode;
  sourcePreviewMode?: SourcePreviewMode;
}

export type AnalysisUpdateResult =
  | { kind: "ok"; record: AnalysisRecord }
  | { kind: "conflict"; serverRevision: number }
  | { kind: "not_found" };

export interface AnalysisRepository {
  create(input: AnalysisCreateInput): Promise<AnalysisRecord>;
  get(id: string): Promise<AnalysisRecord | null>;
  /** Все анализы владельца (для экспорта пользовательских данных). */
  listByOwner(sessionId: string | null, userId: string | null): Promise<AnalysisRecord[]>;
  updateStage(id: string, stage: AnalysisStage, progress: number): Promise<AnalysisRecord | null>;
  updateStatus(
    id: string,
    status: AnalysisStatus,
    patch?: { errorCode?: string | null; completedAt?: Date | null }
  ): Promise<AnalysisRecord | null>;
  saveResult(id: string, input: SaveResultInput): Promise<void>;
  /**
   * Оптимистичное редактирование параметров (If-Match / expectedRevision):
   * revision инкрементируется, при расхождении — VERSION_CONFLICT.
   */
  updateFields(
    id: string,
    expectedRevision: number,
    patch: AnalysisUpdatePatch
  ): Promise<AnalysisUpdateResult>;
}
