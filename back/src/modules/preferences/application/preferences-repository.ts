import type {
  ExplanationMode,
  OutputLanguage,
  RetentionMode,
  SourcePreviewMode,
  TextScale,
  ThemeMode,
} from "../../../validation/common";
import type { RevisionedUpdateResult } from "../../versioning/domain/concurrency";

export interface PreferencesCreateInput {
  id: string;
  sessionId: string | null;
  userId: string | null;
  interfaceLanguage: OutputLanguage;
  outputLanguage: OutputLanguage;
  explanationMode: ExplanationMode;
  theme: ThemeMode;
  reducedMotion: boolean;
  textScale: TextScale;
  timezone: string;
  preferredProvider: string | null;
  saveHistory: boolean;
  sourcePreviewMode: SourcePreviewMode;
  retentionMode: RetentionMode;
  defaultReminderOffsetMinutes: number | null;
  pushEnabled: boolean;
}

export interface PreferencesRecord {
  id: string;
  sessionId: string | null;
  userId: string | null;
  interfaceLanguage: OutputLanguage;
  outputLanguage: OutputLanguage;
  explanationMode: ExplanationMode;
  theme: ThemeMode;
  reducedMotion: boolean;
  textScale: TextScale;
  timezone: string;
  preferredProvider: string | null;
  saveHistory: boolean;
  sourcePreviewMode: SourcePreviewMode;
  retentionMode: RetentionMode;
  defaultReminderOffsetMinutes: number | null;
  pushEnabled: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferencesUpdatePatch {
  interfaceLanguage?: OutputLanguage;
  outputLanguage?: OutputLanguage;
  explanationMode?: ExplanationMode;
  theme?: ThemeMode;
  reducedMotion?: boolean;
  textScale?: TextScale;
  timezone?: string;
  preferredProvider?: string | null;
  saveHistory?: boolean;
  sourcePreviewMode?: SourcePreviewMode;
  retentionMode?: RetentionMode;
  defaultReminderOffsetMinutes?: number | null;
  pushEnabled?: boolean;
}

export interface PreferencesRepository {
  /** Владелец: ровно один из sessionId/userId (XOR), иначе null. */
  getForOwner(
    sessionId: string | null,
    userId: string | null
  ): Promise<PreferencesRecord | null>;
  create(input: PreferencesCreateInput): Promise<PreferencesRecord>;
  update(
    id: string,
    expectedRevision: number,
    patch: PreferencesUpdatePatch
  ): Promise<RevisionedUpdateResult<PreferencesRecord>>;
}
