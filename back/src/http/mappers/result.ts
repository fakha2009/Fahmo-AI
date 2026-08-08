import type { AnalysisResult } from "../../validation/ai/analysis-result";
import type { AnalysisRecord } from "../../modules/analysis/application/analysis-repository";
import type { TaskRecord } from "../../modules/tasks/application/task-repository";

/**
 * Маппит внутренний AnalysisResult в формат, который понимает фронтенд
 * (normalizeRemoteResult): summary {standard, simple}, задачи с dueDate/dueTime,
 * importantData из dates/amounts/locations/contacts/links.
 */
export interface RemoteAnalysisResult {
  analysisId: string;
  title: string;
  documentType: string;
  resultLanguage: string;
  createdAt: string;
  summary: { standard: string; simple: string };
  tasks: RemoteTask[];
  importantData: RemoteImportantItem[];
  clarifications: RemoteClarification[];
  warnings: RemoteWarning[];
  sourceText: string;
  pageTexts: unknown[];
  userCorrections: unknown[];
  overallConfidence: string;
  detectedLanguages: string[];
  provider: string;
  model: string | null;
}

export interface RemoteTask {
  id: string;
  title: string;
  simpleTitle: string;
  description: string;
  completed: boolean;
  priority: string;
  dueDate: string | null;
  dueTime: string | null;
  location: string | null;
  reminderMinutes: number | null;
  source: unknown;
  userEdited: boolean;
  confidence: string;
  revision: number;
}

export interface RemoteImportantItem {
  id: string;
  type: string;
  value: string;
  confidence: string;
  source: string | null;
  userEdited: boolean;
}

export interface RemoteClarification {
  id: string;
  question: string;
  fieldPath: string;
  suggestedAnswers: string[];
  required: boolean;
}

export interface RemoteWarning {
  id: string;
  title: string;
  message: string;
  severity: string;
  code: string;
}

export function mapAnalysisResult(
  analysis: AnalysisRecord,
  persistedTasks: TaskRecord[] = []
): RemoteAnalysisResult | null {
  const result = analysis.result;
  if (result === null) {
    return null;
  }
  return {
    analysisId: analysis.id,
    title: result.title,
    documentType: result.documentType,
    resultLanguage: result.outputLanguage,
    createdAt: analysis.completedAt?.toISOString() ?? analysis.createdAt.toISOString(),
    summary: { standard: result.summary, simple: result.simpleExplanation },
    tasks: persistedTasks.length > 0
      ? persistedTasks.filter((task) => task.deletedAt === null).map(mapPersistedTask)
      : result.tasks.map(mapTask),
    importantData: [
      ...result.dates.map((date, index) => ({
        id: `date_${index}`,
        type: "date",
        value: date.rawText,
        confidence: date.confidence,
        source: date.sourceRefs[0]?.pageNumber != null ? `p.${date.sourceRefs[0].pageNumber}` : null,
        userEdited: false,
      })),
      ...result.amounts.map((amount, index) => ({
        id: `amount_${index}`,
        type: "amount",
        value: amount.rawText,
        confidence: amount.confidence,
        source: amount.sourceRefs[0]?.pageNumber != null ? `p.${amount.sourceRefs[0].pageNumber}` : null,
        userEdited: false,
      })),
      ...result.locations.map((location, index) => ({
        id: `location_${index}`,
        type: "address",
        value: location.rawText,
        confidence: location.confidence,
        source: location.sourceRefs[0]?.pageNumber != null ? `p.${location.sourceRefs[0].pageNumber}` : null,
        userEdited: false,
      })),
      ...result.contacts.map((contact, index) => ({
        id: `contact_${index}`,
        type: "contact",
        value: contact.rawText,
        confidence: contact.confidence,
        source: contact.sourceRefs[0]?.pageNumber != null ? `p.${contact.sourceRefs[0].pageNumber}` : null,
        userEdited: false,
      })),
      ...result.links.map((link, index) => ({
        id: `link_${index}`,
        type: "link",
        value: link.rawText,
        confidence: link.confidence,
        source: link.sourceRefs[0]?.pageNumber != null ? `p.${link.sourceRefs[0].pageNumber}` : null,
        userEdited: false,
      })),
    ],
    clarifications: result.clarificationQuestions.map((question, index) => ({
      id: `clarification_${index}`,
      question: question.question,
      fieldPath: question.fieldPath,
      suggestedAnswers: question.suggestedAnswers,
      required: question.required,
    })),
    warnings: result.warnings.map((warning, index) => ({
      id: `warning_${index}`,
      title: warning.messageKey,
      message: warning.messageKey,
      severity: warning.severity,
      code: warning.code,
    })),
    sourceText: "",
    pageTexts: [],
    userCorrections: [],
    overallConfidence: result.overallConfidence,
    detectedLanguages: result.detectedLanguages,
    provider: analysis.provider ?? "unknown",
    model: analysis.model,
  };
}

function mapTask(task: AnalysisResult["tasks"][number]): RemoteTask {
  const deadline = task.deadline;
  const isoDateTime = deadline?.isoDateTime ?? null;
  const isoDate = deadline?.isoDate ?? null;
  return {
    id: task.id,
    title: task.title,
    simpleTitle: task.simpleTitle,
    description: task.description ?? "",
    completed: task.status === "completed",
    priority: task.priority,
    dueDate: isoDate ?? (isoDateTime !== null ? isoDateTime.slice(0, 10) : null),
    dueTime: isoDateTime !== null ? isoDateTime.slice(11, 16) : null,
    location: null,
    reminderMinutes: null,
    source: "ai",
    userEdited: false,
    confidence: task.confidence,
    revision: 1,
  };
}

function mapPersistedTask(task: TaskRecord): RemoteTask {
  const dueAt = task.dueAt?.toISOString() ?? null;
  const sourceRefs = Array.isArray(task.sourceData) ? task.sourceData : [];
  return {
    id: task.id,
    title: task.title,
    simpleTitle: task.simpleTitle,
    description: task.description ?? "",
    completed: task.status === "completed",
    priority: task.priority,
    dueDate: dueAt?.slice(0, 10) ?? null,
    dueTime: dueAt?.slice(11, 16) ?? null,
    location: null,
    reminderMinutes: null,
    source: sourceRefs[0] ?? null,
    userEdited: task.aiOriginal !== null && task.updatedAt.getTime() > task.createdAt.getTime(),
    confidence: "high",
    revision: task.revision,
  };
}
