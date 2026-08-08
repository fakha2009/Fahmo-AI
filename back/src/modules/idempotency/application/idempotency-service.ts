import { AppError } from "../../../shared/errors";
import { sha256Hex } from "../../../shared/utils/hash";
import type { IdempotencyRepository, IdempotencyRecord } from "./idempotency-repository";
import type { IdempotencyKey } from "../../../validation/request/idempotency";

export interface IdempotencyOutcome<T> {
  /** true — запрос выполнен впервые, результат нужно сохранить. */
  isNew: boolean;
  record: IdempotencyRecord | null;
  result: T | null;
}

export interface IdempotencyServiceOptions {
  ttlMs: number;
}

export const DEFAULT_IDEMPOTENCY_OPTIONS: IdempotencyServiceOptions = {
  ttlMs: 24 * 60 * 60 * 1000,
};

/**
 * Идемпотентность по (actor, idempotencyKey): первый запрос создаёт запись,
 * повторный (в пределах TTL) возвращает сохранённый ответ без выполнения.
 * requestHash (SHA-256 тела+метода) защищает от «хищения» ключа другим
 * запросом — расхождение → IDEMPOTENCY_CONFLICT.
 */
export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly options: IdempotencyServiceOptions = DEFAULT_IDEMPOTENCY_OPTIONS,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Взять/занять слот идемпотентности. Вызывается ДО выполнения запроса.
   * requestHash — SHA-256 от канонического представления запроса.
   */
  async acquire(
    actorKey: string,
    idempotencyKey: IdempotencyKey,
    endpoint: string,
    requestHash: string
  ): Promise<IdempotencyOutcome<never>> {
    const record = await this.repository.get(actorKey, idempotencyKey);
    if (record !== null) {
      if (record.requestHash !== null && record.requestHash !== requestHash) {
        throw new AppError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "idempotencyKey уже использован другим запросом",
        });
      }
      return { isNew: false, record, result: null };
    }
    await this.repository.create({
      actorKey,
      idempotencyKey,
      endpoint,
      requestHash,
      responseStatus: 0,
      responseBody: null,
      expiresAt: new Date(this.now().getTime() + this.options.ttlMs),
    });
    return { isNew: true, record: null, result: null };
  }

  /** Зафиксировать успешный ответ (после выполнения). */
  async complete(
    actorKey: string,
    idempotencyKey: IdempotencyKey,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    await this.repository.update(actorKey, idempotencyKey, responseStatus, responseBody);
  }

  async cleanupExpired(): Promise<number> {
    return this.repository.deleteExpired(this.now());
  }
}

export function hashRequest(
  method: string,
  path: string,
  body: unknown
): string {
  return sha256Hex(JSON.stringify([method, path, body]));
}
