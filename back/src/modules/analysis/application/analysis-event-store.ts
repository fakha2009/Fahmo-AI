import type { AnalysisEvent, AnalysisEventInput } from "./analysis-event-publisher";

export interface AnalysisEventStore {
  /** Сохраняет событие и возвращает его с присвоенным монотонным id. */
  create(input: AnalysisEventInput): Promise<AnalysisEvent>;
  /** Последние события анализа (для восстановления стрима без Last-Event-ID). */
  listForAnalysis(analysisId: string, limit: number): Promise<AnalysisEvent[]>;
  /** События с id строго больше afterId в порядке возрастания (replay по Last-Event-ID). */
  listAfter(analysisId: string, afterId: number, limit: number): Promise<AnalysisEvent[]>;
  /** Чистка append-only журнала: удаляет события старше now. */
  deleteOlderThan(now: Date): Promise<number>;
}
