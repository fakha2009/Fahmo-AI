import type { AnalysisResult } from "../../validation/ai/analysis-result";
import {
  SourceReferenceSchema,
  type SourceReference,
} from "../../validation/ai/source-reference";
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
  source: RemoteSourceReference | null;
  userEdited: boolean;
  confidence: string;
  revision: number;
}

export interface RemoteImportantItem {
  id: string;
  type: string;
  value: string;
  confidence: string;
  source: RemoteSourceReference | null;
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
  source: RemoteSourceReference | null;
}

export interface RemoteSourceReference {
  sourceId: string;
  clientPageId: string;
  sourceAssetId: string | null;
  page: number;
  pageNumber: number | null;
  excerpt: string | null;
  boundingBox: SourceReference["boundingBox"];
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
    importantData: mapImportantData(result),
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
      source: mapSourceReference(warning.sourceRefs[0]),
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
    source: mapSourceReference(task.sourceRefs[0]),
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
    source: mapUnknownSourceReference(sourceRefs[0]),
    userEdited: task.aiOriginal !== null && task.updatedAt.getTime() > task.createdAt.getTime(),
    confidence: "high",
    revision: task.revision,
  };
}

function mapImportantData(result: AnalysisResult): RemoteImportantItem[] {
  const candidates: RemoteImportantItem[] = [];
  const add = (
    id: string,
    type: string,
    value: string | null,
    confidence: string,
    source: SourceReference | undefined
  ): void => {
    const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
    if (!isMeaningfulValue(normalized)) {
      return;
    }
    candidates.push({
      id,
      type,
      value: normalized,
      confidence,
      source: mapSourceReference(source),
      userEdited: false,
    });
  };

  result.dates.forEach((date, index) => {
    if (date.isoDate === null && date.isoDateTime === null) return;
    add(`date_${index}`, date.kind === "deadline" ? "deadline" : "date", preferredValue(date.rawText, date.isoDateTime ?? date.isoDate), date.confidence, date.sourceRefs[0]);
  });
  result.amounts.forEach((amount, index) => {
    if (amount.value === null) return;
    const normalized = `${amount.value}${amount.currency === null ? "" : ` ${amount.currency}`}`;
    add(`amount_${index}`, "amount", preferredValue(amount.rawText, normalized), amount.confidence, amount.sourceRefs[0]);
  });
  result.locations.forEach((location, index) => {
    const structured = location.address ?? location.name;
    add(`location_${index}`, "address", preferredValue(location.rawText, structured), location.confidence, location.sourceRefs[0]);
  });
  result.contacts.forEach((contact, index) => {
    if (contact.value === null) return;
    add(`contact_${index}`, contact.type === "link" ? "link" : "contact", preferredValue(contact.rawText, contact.value), contact.confidence, contact.sourceRefs[0]);
  });
  result.requiredDocuments.forEach((document, index) => {
    const value = document.description === null ? document.name : `${document.name} — ${document.description}`;
    add(`document_${index}`, "document", value, document.confidence, document.sourceRefs[0]);
  });
  result.links.forEach((link, index) => {
    if (link.url === null) return;
    add(`link_${index}`, "link", preferredValue(link.rawText, link.url), link.confidence, link.sourceRefs[0]);
  });

  const seen = new Set<string>();
  const confidenceRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return candidates
    .filter((item) => {
      const key = `${item.type}:${item.value.toLocaleLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (confidenceRank[left.confidence] ?? 3) - (confidenceRank[right.confidence] ?? 3))
    .slice(0, 24);
}

function preferredValue(rawText: string, structured: string | null): string | null {
  return isMeaningfulValue(rawText) ? rawText : structured;
}

function isMeaningfulValue(value: string): boolean {
  if (value.length < 2) return false;
  return !/^(?:дата|date|сана|время|time|вақт|сумма|amount|маблағ|адрес|address|суроға|контакт|contact|тамос|ссылка|link|пайванд)\s*:?[\s.]*$/iu.test(value);
}

function mapSourceReference(reference: SourceReference | undefined): RemoteSourceReference | null {
  if (reference === undefined) return null;
  return {
    sourceId: reference.clientPageId,
    clientPageId: reference.clientPageId,
    sourceAssetId: reference.sourceAssetId,
    page: reference.pageNumber ?? 1,
    pageNumber: reference.pageNumber,
    excerpt: reference.excerpt,
    boundingBox: reference.boundingBox,
  };
}

function mapUnknownSourceReference(reference: unknown): RemoteSourceReference | null {
  const parsed = SourceReferenceSchema.safeParse(reference);
  return parsed.success ? mapSourceReference(parsed.data) : null;
}
