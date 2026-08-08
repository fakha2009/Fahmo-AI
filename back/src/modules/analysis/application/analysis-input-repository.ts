import { Readable } from "node:stream";
import type { InputEnvelope } from "../../ingestion/domain/types";

export interface AnalysisInputRecord {
  index: number;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  /** Ключ входного файла в staging (image/pdf); null для текстовых входов. */
  stagingKey: string | null;
  /** Содержимое текстового входа (для регидрации без storage). */
  textContent: string | null;
}

export interface PersistAnalysisInputInput {
  index: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  stagingKey: string | null;
  textContent: string | null;
  /** SHA-256 исходного файла (если известен на момент сохранения). */
  sha256?: string;
}

export interface AnalysisInputRepository {
  /** Сохраняет входные файлы анализа до постановки в очередь (upsert по analysis_id+index). */
  saveForAnalysis(analysisId: string, inputs: PersistAnalysisInputInput[]): Promise<void>;
  listForAnalysis(analysisId: string): Promise<AnalysisInputRecord[]>;
}

/**
 * Регидрация InputEnvelope[] для фонового воркера:
 * файлы — из staging (storage.get), текст — из сохранённого содержимого.
 */
export async function toInputEnvelopes(
  records: AnalysisInputRecord[],
  storage: { get(key: string): Promise<Readable> }
): Promise<InputEnvelope[]> {
  const envelopes: InputEnvelope[] = [];
  for (const record of records) {
    let content: Readable;
    if (record.stagingKey !== null) {
      content = await storage.get(record.stagingKey);
    } else if (record.textContent !== null) {
      content = Readable.from(Buffer.from(record.textContent, "utf8"));
    } else {
      throw new Error(`input ${record.index}: neither stagingKey nor textContent`);
    }
    envelopes.push({
      index: record.index,
      originalName: record.originalName ?? `input-${record.index}`,
      declaredMimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      content,
    });
  }
  return envelopes;
}
