/**
 * Сборка архива пользовательских данных (User Data Export).
 * Оригинальные документы/файлы НЕ включаются — только результат анализа,
 * задачи, напоминания, предпочтения и история правок.
 */

export interface UserDataAnalysis {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  documentType: string;
  outputLanguage: string;
  title: string | null;
  summary: string;
  warnings: unknown;
  simpleExplanation: string;
  confidence: string;
}

export interface UserDataTask {
  id: string;
  analysisId: string;
  title: string;
  simpleTitle: string | null;
  description: string | null;
  simpleDescription: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDataReminder {
  id: string;
  taskId: string;
  channel: string;
  remindAt: string;
  status: string;
  createdAt: string;
}

export interface UserDataPreferences {
  ownerType: "session" | "user";
  themeMode: string;
  textScale: string;
  notificationEnabled: boolean;
  retentionMode: string;
}

export interface UserDataEdit {
  analysisId: string;
  version: number;
  changeSource: string;
  createdAt: string;
  changedFields: unknown;
}

export interface UserDataBundleInput {
  exportedAt: string;
  preferences: UserDataPreferences | null;
  analyses: UserDataAnalysis[];
  tasks: UserDataTask[];
  reminders: UserDataReminder[];
  edits: UserDataEdit[];
}

export interface UserDataBundle {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  preferences: UserDataPreferences | null;
  analyses: UserDataAnalysis[];
  tasks: UserDataTask[];
  reminders: UserDataReminder[];
  edits: UserDataEdit[];
}

const SCHEMA_VERSION = 1;

export function buildUserDataBundle(input: UserDataBundleInput): UserDataBundle {
  return {
    app: "fahmo-ai",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    preferences: input.preferences,
    analyses: input.analyses,
    tasks: input.tasks,
    reminders: input.reminders,
    edits: input.edits,
  };
}

export function serializeUserDataBundle(bundle: UserDataBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
