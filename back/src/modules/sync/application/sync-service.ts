import type { SyncChangeRepository, SyncItem } from "./sync-repository";

export interface SyncQueryInput {
  /** Обновления строго после этой метки времени (updatedAfter). */
  updatedAfter: Date;
  limit: number;
}

export interface SyncPage {
  items: SyncItem[];
  /** Cursor для следующей страницы (base64 от updatedAt последней записи). */
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeSyncCursor(updatedAt: string): string {
  return Buffer.from(`sync:${updatedAt}`, "utf8").toString("base64url");
}

export function decodeSyncCursor(cursor: string): Date | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded.startsWith("sync:")) {
      return null;
    }
    const timestamp = decoded.slice("sync:".length);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Offline-синхронизация (GET /sync + updatedAfter / cursor):
 * отдаёт изменения владельца, отсортированные по updatedAt, без состояния
 * на сервере — повторный запрос с тем же cursor безопасен (идемпотентен).
 */
export class SyncService {
  constructor(private readonly repository: SyncChangeRepository) {}

  async getChanges(
    owner: { sessionId: string | null; userId: string | null },
    input: SyncQueryInput
  ): Promise<SyncPage> {
    const items = await this.repository.listChanges(owner, input.updatedAfter, input.limit);
    const hasMore = items.length === input.limit;
    const last = items[items.length - 1];
    const nextCursor = last === undefined ? null : encodeSyncCursor(last.updatedAt);
    return { items, nextCursor, hasMore };
  }
}
