export interface EnqueueJobOptions {
  dedupKey?: string | null;
}

export interface EnqueuedJob {
  id: string;
  queue: string;
  payload: unknown;
}

export interface ClaimedJob {
  id: string;
  queue: string;
  payload: unknown;
  attemptCount: number;
}

export interface JobRepository {
  enqueue(queue: string, payload: unknown, options?: EnqueueJobOptions): Promise<EnqueuedJob>;
  complete(id: string): Promise<void>;
  fail(id: string, errorCode: string, errorMessage: string | null): Promise<void>;
  /**
   * Атомарный claim следующего доступного job'а: QUEUED + available_at <= now →
   * RUNNING, attempt_count + 1. Гарантия — updateMany-гвард внутри транзакции.
   */
  claimNext(queue: string, now?: Date): Promise<ClaimedJob | null>;
  /**
   * Возвращает в очередь job'ы, застрявшие в RUNNING дольше, чем before:
   * attempt_count < maxAttempts → снова QUEUED, иначе → FAILED.
   */
  reclaimStale(queue: string, before: Date, maxAttempts?: number): Promise<number>;
}
