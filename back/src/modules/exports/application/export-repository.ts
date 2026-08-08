export type ExportKind = "pdf" | "ics" | "data";
export type ExportJobStatus = "queued" | "running" | "done" | "failed";

export interface ExportJobCreateInput {
  id: string;
  kind: ExportKind;
  analysisId: string | null;
  sessionId: string | null;
  userId: string | null;
  payload: unknown;
  expiresAt: Date;
}

export interface ExportJobRecord {
  id: string;
  kind: ExportKind;
  status: ExportJobStatus;
  analysisId: string | null;
  sessionId: string | null;
  userId: string | null;
  storageKey: string | null;
  payload: unknown;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface ExportJobRepository {
  create(input: ExportJobCreateInput): Promise<ExportJobRecord>;
  get(id: string): Promise<ExportJobRecord | null>;
  listForOwner(
    sessionId: string | null,
    userId: string | null,
    limit: number
  ): Promise<ExportJobRecord[]>;
  /**
   * Атомарно захватывает следующий активный (QUEUED, не истёкший) job:
   * перевод в RUNNING выполняется через условный updateMany; при гонке
   * возвращается null.
   */
  claimNext(now: Date): Promise<ExportJobRecord | null>;
  complete(id: string, storageKey: string, now: Date): Promise<ExportJobRecord | null>;
  fail(id: string, errorCode: string): Promise<ExportJobRecord | null>;
  /** Завершённые/проваленные задания с истёкшим сроком хранения. */
  listExpired(now: Date): Promise<ExportJobRecord[]>;
  /** Удаляет завершённые/истёкшие задания старше now. */
  deleteExpired(now: Date): Promise<number>;
}
