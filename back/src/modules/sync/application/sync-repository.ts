import type { AnalysisRecord } from "../../analysis/application/analysis-repository";
import type { TaskRecord } from "../../tasks/application/task-repository";
import type { ReminderRecord } from "../../reminders/application/reminder-repository";
import type { PreferencesRecord } from "../../preferences/application/preferences-repository";

/**
 * Запись изменения для offline-синхронизации. Поле `deleted` помечает
 * soft-delete (Task.deleted_at) или отмену (Reminder.status = CANCELLED,
 * Analysis.status = CANCELLED/FAILED — клиент убирает сущность локально).
 */
export type SyncItem =
  | {
      entity: "analysis";
      id: string;
      revision: number;
      updatedAt: string;
      deleted: boolean;
      data: AnalysisRecord;
    }
  | {
      entity: "task";
      id: string;
      revision: number;
      updatedAt: string;
      deleted: boolean;
      data: TaskRecord;
    }
  | {
      entity: "reminder";
      id: string;
      revision: number;
      updatedAt: string;
      deleted: boolean;
      data: ReminderRecord;
    }
  | {
      entity: "preferences";
      id: string;
      revision: number;
      updatedAt: string;
      deleted: boolean;
      data: PreferencesRecord;
    };

export type SyncEntityName = SyncItem["entity"];

export interface SyncOwner {
  sessionId: string | null;
  userId: string | null;
}

export interface SyncChangeRepository {
  /**
   * Изменения владельца с updatedAt (или deletedAt для мягко удалённых)
   * строго позже `since`, в порядке возрастания updatedAt, не более `limit`.
   */
  listChanges(
    owner: SyncOwner,
    since: Date,
    limit: number
  ): Promise<SyncItem[]>;
}
