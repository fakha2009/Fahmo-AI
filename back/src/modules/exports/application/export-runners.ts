import { Readable } from "node:stream";
import type { AnalysisVersionRecord } from "../../analysis/application/analysis-version-repository";
import type { AnalysisRecord } from "../../analysis/application/analysis-repository";
import type { TaskRecord } from "../../tasks/application/task-repository";
import type { ReminderRecord } from "../../reminders/application/reminder-repository";
import type { PreferencesRecord } from "../../preferences/application/preferences-repository";
import type { ExportJobRecord } from "./export-repository";
import type { PdfExportData, PdfTaskRow, PdfUserEditRow, PdfWarningRow } from "../domain/pdf-document";
import { PdfExportRenderer } from "../domain/pdf-document";
import { IcsGenerator, type IcsEventInput } from "../domain/ics";
import {
  buildUserDataBundle,
  serializeUserDataBundle,
  type UserDataAnalysis,
  type UserDataReminder,
  type UserDataTask,
  type UserDataPreferences,
} from "../domain/user-data";

export interface ExportArtifact {
  contentType: string;
  filename: string;
  body: Buffer;
}

export interface ExportDataPorts {
  analysisRepository: {
    get(id: string): Promise<AnalysisRecord | null>;
    listByOwner(sessionId: string | null, userId: string | null): Promise<AnalysisRecord[]>;
  };
  taskRepository: {
    get(id: string): Promise<TaskRecord | null>;
    listByAnalysis(analysisId: string): Promise<TaskRecord[]>;
    listByOwner(sessionId: string | null, userId: string | null): Promise<TaskRecord[]>;
  };
  reminderRepository: {
    listByTaskIds(taskIds: string[]): Promise<ReminderRecord[]>;
  };
  versionRepository: {
    listForAnalysis(analysisId: string): Promise<AnalysisVersionRecord[]>;
  };
  preferencesRepository: {
    getForOwner(sessionId: string | null, userId: string | null): Promise<PreferencesRecord | null>;
  };
}

/**
 * PDF: объяснение, задачи, предупреждения, простая версия и
 * пользовательские изменения. Оригинальный документ НЕ включается.
 */
export class PdfExportRunner {
  constructor(
    private readonly ports: Pick<ExportDataPorts, "taskRepository" | "versionRepository">,
    private readonly renderer: PdfExportRenderer,
    private readonly font: () => { regularBytes: Uint8Array | null; boldBytes: Uint8Array | null }
  ) {}

  async run(_job: ExportJobRecord, analysis: AnalysisRecord): Promise<ExportArtifact> {
    const result = analysis.result;
    if (result === null) {
      throw new Error("analysis has no result");
    }
    const tasks = await this.ports.taskRepository.listByAnalysis(analysis.id);
    const edits = await this.ports.versionRepository.listForAnalysis(analysis.id);
    const font = this.font();

    const data: PdfExportData = {
      analysisId: analysis.id,
      title: result.title,
      createdAt: analysis.completedAt?.toISOString() ?? analysis.createdAt.toISOString(),
      documentType: result.documentType,
      outputLanguage: result.outputLanguage,
      overallConfidence: result.overallConfidence,
      summary: result.summary,
      simpleExplanation: result.simpleExplanation,
      warnings: result.warnings.map(toWarningRow),
      tasks: tasks.map(toTaskRow),
      userEdits: edits.filter((edit) => edit.userEdited !== null).map(toEditRow),
    };

    const pdf = await this.renderer.render(data, {
      fontBytes: font.regularBytes,
      boldFontBytes: font.boldBytes,
    });
    return {
      contentType: "application/pdf",
      filename: `fahmo-analysis-${analysis.id}.pdf`,
      body: Buffer.from(pdf),
    };
  }
}

/** ICS: календарные события напоминаний выбранных задач. */
export class IcsExportRunner {
  constructor(
    private readonly ports: Pick<ExportDataPorts, "taskRepository" | "reminderRepository">
  ) {}

  async run(_job: ExportJobRecord, taskIds: string[]): Promise<ExportArtifact> {
    if (taskIds.length === 0) {
      throw new Error("ics export requires taskIds");
    }
    const tasks = (await Promise.all(taskIds.map((id) => this.ports.taskRepository.get(id)))).filter(
      (task): task is TaskRecord => task !== null
    );
    const reminders = await this.ports.reminderRepository.listByTaskIds(taskIds);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const events: IcsEventInput[] = [];
    for (const reminder of reminders) {
      const task = taskById.get(reminder.taskId);
      if (task === undefined) {
        continue;
      }
      events.push({
        uid: `fahmo-${task.id}-${reminder.id}@fahmo.ai`,
        title: task.title,
        description: task.description ?? null,
        start: reminder.scheduledAt.toISOString(),
        timezone: reminder.timezone ?? task.timezone ?? null,
        status: reminder.status === "cancelled" ? "cancelled" : "confirmed",
      });
    }
    const generator = new IcsGenerator({
      productId: "-//Fahmo AI//Fahmo AI Export//RU",
      calendarName: "Fahmo AI",
    });
    const body = Buffer.from(generator.generate(events), "utf8");
    return {
      contentType: "text/calendar; charset=utf-8",
      filename: `fahmo-calendar-${_job.id}.ics`,
      body,
    };
  }
}

/** User Data Export: JSON со всеми данными владельца без оригиналов. */
export class DataExportRunner {
  constructor(private readonly ports: ExportDataPorts) {}

  async run(job: ExportJobRecord): Promise<ExportArtifact> {
    const owner = { sessionId: job.sessionId, userId: job.userId };
    const analyses = await this.ports.analysisRepository.listByOwner(owner.sessionId, owner.userId);
    const tasks = await this.ports.taskRepository.listByOwner(owner.sessionId, owner.userId);
    const reminders = await this.ports.reminderRepository.listByTaskIds(tasks.map((t) => t.id));
    const edits = (
      await Promise.all(analyses.map((a) => this.ports.versionRepository.listForAnalysis(a.id)))
    ).flat();
    const preferences = await this.ports.preferencesRepository.getForOwner(owner.sessionId, owner.userId);

    const bundle = buildUserDataBundle({
      exportedAt: new Date().toISOString(),
      preferences: preferences === null ? null : toPreferences(preferences),
      analyses: analyses.map(toAnalysis),
      tasks: tasks.map(toTask),
      reminders: reminders.map(toReminder),
      edits: edits.map((edit) => ({
        analysisId: edit.analysisId,
        version: edit.version,
        changeSource: edit.changeSource,
        createdAt: edit.createdAt.toISOString(),
        changedFields: edit.changedFields,
      })),
    });
    const body = Buffer.from(serializeUserDataBundle(bundle), "utf8");
    return {
      contentType: "application/json; charset=utf-8",
      filename: `fahmo-user-data-${job.id}.json`,
      body,
    };
  }
}

export function artifactToReadable(artifact: ExportArtifact): Readable {
  return Readable.from(artifact.body);
}

function toWarningRow(
  warning: { code: string; messageKey: string; severity: "info" | "warning" | "critical" }
): PdfWarningRow {
  return {
    code: warning.code,
    message: warningMessage(warning.code, warning.messageKey),
    severity: warning.severity,
  };
}

const WARNING_MESSAGES: Record<string, string> = {
  UNCLEAR_TEXT: "Текст неоднозначен",
  AMBIGUOUS_DATE: "Дата указана неоднозначно",
  AMBIGUOUS_AMOUNT: "Сумма указана неоднозначно",
  CONFLICTING_INFORMATION: "Сведения в документе противоречат друг другу",
  MISSING_INFORMATION: "Отсутствует информация",
  LOW_CONFIDENCE: "Низкая уверенность распознавания",
  UNSUPPORTED_CONTENT: "Неподдерживаемый контент",
};

function warningMessage(code: string, messageKey: string): string {
  return WARNING_MESSAGES[code] ?? messageKey;
}

function toTaskRow(task: TaskRecord): PdfTaskRow {
  return {
    title: task.title,
    simpleTitle: task.simpleTitle,
    description: task.description,
    simpleDescription: task.simpleDescription,
    dueAt: task.dueAt === null ? null : task.dueAt.toISOString(),
    status: task.status,
    priority: task.priority,
  };
}

function toEditRow(edit: AnalysisVersionRecord): PdfUserEditRow {
  return {
    version: edit.version,
    changeSource: edit.changeSource,
    createdAt: edit.createdAt.toISOString(),
    changedFields: edit.changedFields,
  };
}

function toAnalysis(analysis: AnalysisRecord): UserDataAnalysis {
  const result = analysis.result;
  return {
    id: analysis.id,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
    status: analysis.status,
    documentType: analysis.documentType,
    outputLanguage: analysis.outputLanguage,
    title: result?.title ?? null,
    summary: result?.summary ?? "",
    warnings: result?.warnings ?? [],
    simpleExplanation: result?.simpleExplanation ?? "",
    confidence: result?.overallConfidence ?? "low",
  };
}

function toTask(task: TaskRecord): UserDataTask {
  return {
    id: task.id,
    analysisId: task.analysisId ?? "",
    title: task.title,
    simpleTitle: task.simpleTitle,
    description: task.description,
    simpleDescription: task.simpleDescription,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    timezone: task.timezone,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function toReminder(reminder: ReminderRecord): UserDataReminder {
  return {
    id: reminder.id,
    taskId: reminder.taskId,
    channel: reminder.channel,
    remindAt: reminder.scheduledAt.toISOString(),
    status: reminder.status,
    createdAt: reminder.createdAt.toISOString(),
  };
}

function toPreferences(preferences: PreferencesRecord): UserDataPreferences {
  return {
    ownerType: preferences.sessionId !== null ? "session" : "user",
    themeMode: preferences.theme,
    textScale: preferences.textScale,
    notificationEnabled: preferences.pushEnabled,
    retentionMode: preferences.retentionMode,
  };
}
