import type { IdempotencyKey } from "../../../validation/request/idempotency";

export interface IdempotencyRecord {
  id: string;
  actorKey: string;
  idempotencyKey: IdempotencyKey;
  endpoint: string;
  requestHash: string | null;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface StoredIdempotencyRecord {
  actorKey: string;
  idempotencyKey: IdempotencyKey;
  endpoint: string;
  requestHash: string | null;
  responseStatus: number;
  responseBody: unknown;
  expiresAt: Date;
}

export interface IdempotencyRepository {
  /**
   * Атомарная вставка записи; при уникальном конфликте (actor, key)
   * возвращается уже существующая запись.
   */
  create(input: StoredIdempotencyRecord): Promise<IdempotencyRecord>;
  /** Сохранить результат выполненного запроса (статус и тело ответа). */
  update(
    actorKey: string,
    idempotencyKey: IdempotencyKey,
    responseStatus: number,
    responseBody: unknown
  ): Promise<IdempotencyRecord | null>;
  get(actorKey: string, idempotencyKey: IdempotencyKey): Promise<IdempotencyRecord | null>;
  deleteExpired(now: Date): Promise<number>;
}
