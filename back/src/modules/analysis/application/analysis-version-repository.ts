import type { ChangeSource } from "../../../validation/common";

export interface AnalysisVersionRecord {
  id: string;
  analysisId: string;
  version: number;
  changeSource: ChangeSource;
  aiOriginal: unknown | null;
  userEdited: unknown | null;
  structuredResult: unknown | null;
  changedFields: unknown | null;
  createdAt: Date;
}

export interface AnalysisVersionRepository {
  /** Все версии анализа по возрастанию номера версии. */
  listForAnalysis(analysisId: string): Promise<AnalysisVersionRecord[]>;
  /**
   * Версии, в которых пользователь реально что-то изменил
   * (user_edited заполнен) — история пользовательских правок.
   */
  listUserEdits(analysisId: string): Promise<AnalysisVersionRecord[]>;
}
