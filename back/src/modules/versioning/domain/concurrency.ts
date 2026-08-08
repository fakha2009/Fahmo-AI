import { AppError } from "../../../shared/errors";

/**
 * Ожидаемая клиентом версия (If-Match: revision-N / expectedRevision в теле).
 * Все изменяемые сущности (Analysis, Task, Reminder, UserPreferences)
 * редактируются оптимистично: update применится только если текущая
 * revision совпадает с ожидаемой, иначе — VERSION_CONFLICT.
 */
export type ExpectedRevision = number;

/** Результат оптимистичного обновления. */
export type RevisionedUpdateResult<T> =
  | { kind: "ok"; record: T }
  | { kind: "conflict"; serverRevision: number }
  | { kind: "not_found" };

export function revisionConflict(serverRevision: number): AppError {
  return new AppError({
    code: "VERSION_CONFLICT",
    params: { serverRevision },
  });
}
