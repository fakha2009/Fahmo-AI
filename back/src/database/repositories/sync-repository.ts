import type { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { analysisToRecord } from "./analysis-repository";
import { taskToRecord } from "./task-repository";
import { reminderToRecord } from "./reminder-repository";
import { preferencesToRecord } from "./preferences-repository";
import type {
  SyncChangeRepository,
  SyncItem,
  SyncOwner,
} from "../../modules/sync/application/sync-repository";

function ownerClause(owner: SyncOwner): { session_id?: string; user_id?: string } {
  if (owner.sessionId !== null) {
    return { session_id: owner.sessionId };
  }
  if (owner.userId !== null) {
    return { user_id: owner.userId };
  }
  return {};
}

function sinceWhere(since: Date): Prisma.DateTimeFilter {
  return { gt: since };
}

export class PrismaSyncRepository implements SyncChangeRepository {  async listChanges(owner: SyncOwner, since: Date, limit: number): Promise<SyncItem[]> {
    const [analyses, tasks, reminders, preferences] = await Promise.all([
      prisma.analysis.findMany({
        where: { ...ownerClause(owner), updated_at: sinceWhere(since) },
        orderBy: { updated_at: "asc" },
        take: limit,
      }),
      prisma.task.findMany({
        where: {
          ...ownerClause(owner),
          OR: [
            { updated_at: sinceWhere(since) },
            { deleted_at: sinceWhere(since) },
          ],
        },
        orderBy: { updated_at: "asc" },
        take: limit,
      }),
      prisma.reminder.findMany({
        where: { task: ownerClause(owner), updated_at: sinceWhere(since) },
        orderBy: { updated_at: "asc" },
        take: limit,
      }),
      prisma.userPreferences.findMany({
        where: { ...ownerClause(owner), updated_at: sinceWhere(since) },
        orderBy: { updated_at: "asc" },
        take: limit,
      }),
    ]);

    const items: SyncItem[] = [
      ...analyses.map((row) => {
        const record = analysisToRecord(row);
        return {
          entity: "analysis",
          id: row.id,
          revision: row.revision,
          updatedAt: record.updatedAt.toISOString(),
          deleted: false,
          data: record,
        } satisfies SyncItem;
      }),
      ...tasks.map((row) => {
        const record = taskToRecord(row);
        return {
          entity: "task",
          id: row.id,
          revision: row.revision,
          updatedAt: record.updatedAt.toISOString(),
          deleted: row.deleted_at !== null,
          data: record,
        } satisfies SyncItem;
      }),
      ...reminders.map((row) => {
        const record = reminderToRecord(row);
        return {
          entity: "reminder",
          id: row.id,
          revision: row.revision,
          updatedAt: record.updatedAt.toISOString(),
          deleted: row.status === "CANCELLED",
          data: record,
        } satisfies SyncItem;
      }),
      ...preferences.map((row) => {
        const record = preferencesToRecord(row);
        return {
          entity: "preferences",
          id: row.id,
          revision: row.revision,
          updatedAt: record.updatedAt.toISOString(),
          deleted: false,
          data: record,
        } satisfies SyncItem;
      }),
    ];

    items.sort(
      (a, b) => a.updatedAt.localeCompare(b.updatedAt)
    );
    return items.slice(0, limit);
  }
}
