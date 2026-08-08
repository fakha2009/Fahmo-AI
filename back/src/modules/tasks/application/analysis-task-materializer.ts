import { randomHex } from "../../../shared/utils/hash";
import type { AnalysisRecord } from "../../analysis/application/analysis-repository";
import type { TaskRepository } from "./task-repository";

/**
 * Persists AI-extracted tasks exactly once so follow-up task/reminder actions
 * operate on revisioned server records instead of on a response snapshot.
 */
export class AnalysisTaskMaterializer {
  constructor(private readonly tasks: TaskRepository) {}

  async materialize(analysis: AnalysisRecord): Promise<void> {
    if (analysis.result === null || (analysis.sessionId === null && analysis.userId === null)) {
      return;
    }
    const existing = await this.tasks.listByAnalysis(analysis.id);
    const existingMutations = new Set(
      existing.map((task) => task.clientMutationId).filter((value): value is string => value !== null)
    );

    for (const task of analysis.result.tasks) {
      const clientMutationId = taskMutationId(analysis.id, task.id);
      if (existingMutations.has(clientMutationId)) {
        continue;
      }
      const dueAt = task.deadline?.isoDateTime !== null && task.deadline?.isoDateTime !== undefined
        ? new Date(task.deadline.isoDateTime)
        : task.deadline?.isoDate !== null && task.deadline?.isoDate !== undefined
          ? new Date(`${task.deadline.isoDate}T00:00:00.000Z`)
          : null;
      await this.tasks.createWithClientMutation({
        id: randomHex(16),
        analysisId: analysis.id,
        sessionId: analysis.sessionId,
        userId: analysis.userId,
        title: task.title,
        description: task.description,
        simpleTitle: task.simpleTitle,
        simpleDescription: task.simpleDescription,
        assigneeText: task.assigneeText,
        priority: task.priority,
        status: task.status,
        dueAt,
        timezone: task.deadline?.timezone ?? null,
        sourceData: task.sourceRefs,
        aiOriginal: task,
        clientMutationId,
      });
      existingMutations.add(clientMutationId);
    }
  }
}

function taskMutationId(analysisId: string, taskId: string): string {
  return `analysis.${analysisId}.${taskId}`.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}
